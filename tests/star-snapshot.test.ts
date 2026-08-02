import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestWindowFor } from '@/lib/digest-window';
import type { Repository } from '@/lib/github/schemas';
import {
  collectStarSnapshots,
  mergeStarObservations,
  normalizeFullName,
} from '@/lib/star-snapshot';

const { snapshotCreateManyMock, fetchRepositoryMock, searchTrendingRepositoriesMock } = vi.hoisted(
  () => ({
    snapshotCreateManyMock: vi.fn(),
    fetchRepositoryMock: vi.fn(),
    searchTrendingRepositoriesMock: vi.fn(),
  })
);

vi.mock('@/lib/prisma', () => ({
  prisma: { repoStarSnapshot: { createMany: snapshotCreateManyMock } },
}));

vi.mock('@/lib/github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/github/client')>()),
  fetchRepository: fetchRepositoryMock,
  searchTrendingRepositories: searchTrendingRepositoriesMock,
}));

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    name: 'next.js',
    full_name: 'vercel/next.js',
    owner: { login: 'vercel', avatar_url: 'https://avatars.example/vercel.png' },
    html_url: 'https://github.com/vercel/next.js',
    description: null,
    language: 'TypeScript',
    stargazers_count: 100,
    forks_count: 1,
    open_issues_count: 1,
    created_at: '2020-01-01T00:00:00Z',
    pushed_at: '2026-07-25T00:00:00Z',
    ...overrides,
  };
}

function searchResult(items: Repository[]) {
  return { total_count: items.length, incomplete_results: false, items };
}

/** cronの発火時刻と、それに対応する当日窓 (2026-07-24T21:00Z, 2026-07-25T21:00Z] */
const NOW = new Date('2026-07-25T21:00:30Z');
const WINDOW = digestWindowFor(NOW);
/** 観測日 = 窓終端のUTC日付 */
const OBSERVED_DATE = new Date('2026-07-25T00:00:00.000Z');

const FAVORITE = { owner: 'prisma', name: 'prisma' };

describe('normalizeFullName', () => {
  it('前後の空白を落として小文字化する（ケース違いを同一視する）', () => {
    expect(normalizeFullName(' Vercel/Next.js ')).toBe('vercel/next.js');
  });
});

describe('mergeStarObservations', () => {
  it('トレンドとお気に入りの和集合を正規化して返し、fullName昇順で安定する', () => {
    const merged = mergeStarObservations(
      [{ fullName: 'Zed-Industries/zed', stars: 50 }],
      [{ fullName: 'prisma/prisma', stars: 30 }]
    );
    expect(merged).toEqual([
      { fullName: 'prisma/prisma', stars: 30 },
      { fullName: 'zed-industries/zed', stars: 50 },
    ]);
  });

  // /search の星数は二次インデックス越しで遅れうるため、直接読みのお気に入り側を正とする
  it('ケース違いで重なる銘柄は1行に畳み、お気に入り側（/reposの直接読み）の観測を採る', () => {
    const merged = mergeStarObservations(
      [{ fullName: 'vercel/next.js', stars: 100 }],
      [{ fullName: 'Vercel/Next.js', stars: 999 }]
    );
    expect(merged).toEqual([{ fullName: 'vercel/next.js', stars: 999 }]);
  });

  it('どちらも空なら空を返す', () => {
    expect(mergeStarObservations([], [])).toEqual([]);
  });
});

describe('collectStarSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    searchTrendingRepositoriesMock.mockResolvedValue(
      searchResult([repository({ full_name: 'zed-industries/zed', stargazers_count: 50 })])
    );
    fetchRepositoryMock.mockResolvedValue(
      repository({ full_name: 'prisma/prisma', stargazers_count: 30 })
    );
    snapshotCreateManyMock.mockImplementation(({ data }: { data: unknown[] }) =>
      Promise.resolve({ count: data.length })
    );
  });

  it('トレンドとお気に入りの星数を、窓終端の日付で1往復にまとめて保存する', async () => {
    const result = await collectStarSnapshots(WINDOW, [FAVORITE]);

    expect(snapshotCreateManyMock).toHaveBeenCalledTimes(1);
    expect(snapshotCreateManyMock.mock.calls[0][0]).toEqual({
      data: [
        { fullName: 'prisma/prisma', stars: 30, date: OBSERVED_DATE },
        { fullName: 'zed-industries/zed', stars: 50, date: OBSERVED_DATE },
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({
      date: '2026-07-25',
      observed: 2,
      written: 2,
      fetchFailed: 0,
      writeFailed: 0,
      trendingFailed: false,
    });
  });

  // 窓は24時間あるので、日中の手動実行が「21:00の観測」として何時間も後の星数を焼き付けてはいけない
  it('同日の再実行は既存行を上書きせず、欠けている行だけを足す（先勝ち）', async () => {
    // 既に記録済みの1件はスキップされ、count には数えられない
    snapshotCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await collectStarSnapshots(WINDOW, [FAVORITE]);

    expect(snapshotCreateManyMock.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(result).toMatchObject({ observed: 2, written: 1, writeFailed: 0 });
  });

  it('採取はData Cacheを踏まない（訂正不能な点データを古い観測で焼き付けない）', async () => {
    await collectStarSnapshots(WINDOW, [FAVORITE]);

    expect(searchTrendingRepositoriesMock).toHaveBeenCalledTimes(1);
    expect(searchTrendingRepositoriesMock.mock.calls[0][0]).toMatchObject({
      perPage: 30,
      fresh: true,
      // 相場欄・/trending と同じ30日窓を、窓終端から遡って決める
      createdAfter: new Date('2026-06-25T21:00:00.000Z'),
    });
    expect(fetchRepositoryMock).toHaveBeenCalledWith('prisma', 'prisma', { fresh: true });
  });

  it('お気に入りは全ユーザー横断のユニーク集合ぶんだけ取得する（1リポジトリ1リクエスト）', async () => {
    fetchRepositoryMock.mockImplementation((owner: string, name: string) =>
      Promise.resolve(repository({ full_name: `${owner}/${name}` }))
    );

    const result = await collectStarSnapshots(WINDOW, [FAVORITE, { owner: 'vercel', name: 'ai' }]);

    expect(fetchRepositoryMock).toHaveBeenCalledTimes(2);
    expect(result.observed).toBe(3); // トレンド1 + お気に入り2
  });

  it('トレンド検索の失敗はお気に入りの採取を巻き込まない', async () => {
    searchTrendingRepositoriesMock.mockRejectedValue(new Error('search down'));

    const result = await collectStarSnapshots(WINDOW, [FAVORITE]);

    expect(snapshotCreateManyMock.mock.calls[0][0].data).toEqual([
      { fullName: 'prisma/prisma', stars: 30, date: OBSERVED_DATE },
    ]);
    expect(result).toMatchObject({ observed: 1, written: 1, trendingFailed: true });
  });

  it('お気に入りの取得失敗・404は欠測として数え、他の銘柄は保存する', async () => {
    fetchRepositoryMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(null) // 消滅・private化
      .mockResolvedValueOnce(repository({ full_name: 'prisma/prisma', stargazers_count: 30 }));

    const result = await collectStarSnapshots(WINDOW, [
      { owner: 'gone', name: 'repo' },
      { owner: 'private', name: 'repo' },
      FAVORITE,
    ]);

    expect(result).toMatchObject({ observed: 2, written: 2, fetchFailed: 2 });
    // 恒久欠測になる404は黙って数えるだけにしない
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('private/repo'));
  });

  it('書き込みが落ちても例外を投げず、失敗件数として報告する', async () => {
    snapshotCreateManyMock.mockRejectedValue(new Error('db down'));

    const result = await collectStarSnapshots(WINDOW, [FAVORITE]);

    expect(result).toMatchObject({ observed: 2, written: 0, writeFailed: 2 });
  });

  it('お気に入りが無くてもトレンド銘柄は採取する', async () => {
    const result = await collectStarSnapshots(WINDOW, []);

    expect(fetchRepositoryMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ observed: 1, written: 1 });
  });

  it('1件も観測できなかった日は書き込まず、恒久欠測としてerrorに残す', async () => {
    searchTrendingRepositoriesMock.mockRejectedValue(new Error('search down'));

    const result = await collectStarSnapshots(WINDOW, []);

    expect(snapshotCreateManyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ observed: 0, written: 0, trendingFailed: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('恒久欠測'));
  });
});
