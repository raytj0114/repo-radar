import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestWindowFor } from '@/lib/digest-window';
import type { Repository } from '@/lib/github/schemas';
import {
  collectStarSnapshots,
  loadStarHistories,
  mergeStarObservations,
} from '@/lib/star-snapshot';

const {
  snapshotCreateManyMock,
  snapshotFindManyMock,
  fetchRepositoryMock,
  searchTrendingRepositoriesMock,
} = vi.hoisted(() => ({
  snapshotCreateManyMock: vi.fn(),
  snapshotFindManyMock: vi.fn(),
  fetchRepositoryMock: vi.fn(),
  searchTrendingRepositoriesMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    repoStarSnapshot: { createMany: snapshotCreateManyMock, findMany: snapshotFindManyMock },
  },
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

describe('loadStarHistories', () => {
  /** 相場欄が読む紙面の号（= 上限日） */
  const AS_OF_DAY = '2026-08-01';

  function row(fullName: string, day: string, stars: number) {
    return { fullName, stars, date: new Date(`${day}T00:00:00.000Z`) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotFindManyMock.mockResolvedValue([]);
  });

  it('号を上限・7日前を下限にして、新しい順で引く', async () => {
    await loadStarHistories(['astral-sh/ty'], AS_OF_DAY);

    expect(snapshotFindManyMock).toHaveBeenCalledTimes(1);
    expect(snapshotFindManyMock.mock.calls[0][0]).toEqual({
      where: {
        fullName: { in: ['astral-sh/ty'] },
        date: {
          gte: new Date('2026-07-25T00:00:00.000Z'),
          lte: new Date('2026-08-01T00:00:00.000Z'),
        },
      },
      select: { fullName: true, stars: true, date: true },
      orderBy: [{ fullName: 'asc' }, { date: 'desc' }],
    });
  });

  it('銘柄ごとに新しい2点だけを残す（3点目以降は前日比に使わない）', async () => {
    snapshotFindManyMock.mockResolvedValue([
      row('astral-sh/ty', '2026-08-01', 9000),
      row('astral-sh/ty', '2026-07-31', 8700),
      row('astral-sh/ty', '2026-07-30', 8600),
      row('zed-industries/zed', '2026-07-30', 50),
    ]);

    const histories = await loadStarHistories(['astral-sh/ty', 'zed-industries/zed'], AS_OF_DAY);

    expect(histories.get('astral-sh/ty')).toEqual([
      { day: '2026-08-01', stars: 9000 },
      { day: '2026-07-31', stars: 8700 },
    ]);
    expect(histories.get('zed-industries/zed')).toEqual([{ day: '2026-07-30', stars: 50 }]);
  });

  it('引き当てキーは保存側と同じ正規化（ケース違い・重複を畳む）', async () => {
    await loadStarHistories(['Astral-sh/TY', 'astral-sh/ty'], AS_OF_DAY);

    expect(snapshotFindManyMock.mock.calls[0][0].where.fullName).toEqual({
      in: ['astral-sh/ty'],
    });
  });

  it('銘柄が無ければクエリを投げない（相場欄が休載の日にDBを触らない）', async () => {
    const histories = await loadStarHistories([], AS_OF_DAY);

    expect(snapshotFindManyMock).not.toHaveBeenCalled();
    expect(histories.size).toBe(0);
  });
});
