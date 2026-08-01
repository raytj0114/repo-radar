import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assembleDigestEntries,
  composeDigestOverview,
  digestDayOf,
  digestEntriesSchema,
  digestWindowFor,
  releasesInWindow,
  runDailyDigest,
  type DigestEntry,
} from '@/lib/digest';
import type { Release } from '@/lib/github/schemas';

const {
  digestFindManyMock,
  digestUpsertMock,
  favoritesFindManyMock,
  fetchReleasesMock,
  summaryFindUniqueMock,
  summaryUpsertMock,
  generateStructuredMock,
} = vi.hoisted(() => ({
  digestFindManyMock: vi.fn(),
  digestUpsertMock: vi.fn(),
  favoritesFindManyMock: vi.fn(),
  fetchReleasesMock: vi.fn(),
  summaryFindUniqueMock: vi.fn(),
  summaryUpsertMock: vi.fn(),
  generateStructuredMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyDigest: { findMany: digestFindManyMock, upsert: digestUpsertMock },
    favoriteRepo: { findMany: favoritesFindManyMock },
    releaseSummary: { findUnique: summaryFindUniqueMock, upsert: summaryUpsertMock },
  },
}));

vi.mock('@/lib/github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/github/client')>()),
  fetchReleases: fetchReleasesMock,
}));

vi.mock('@/lib/gemini/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini/client')>()),
  generateStructured: generateStructuredMock,
}));

function release(overrides: Partial<Release>): Release {
  return {
    id: 1,
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    body: 'notes',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/a/b/releases/tag/v1.0.0',
    published_at: '2026-07-25T10:00:00Z',
    ...overrides,
  };
}

function entry(overrides: Partial<DigestEntry>): DigestEntry {
  return {
    owner: 'vercel',
    repo: 'next.js',
    fullName: 'vercel/next.js',
    tagName: 'v1.0.0',
    releaseName: 'v1.0.0',
    publishedAt: '2026-07-25T10:00:00Z',
    headline: '見出し',
    summary: '・要点',
    hasBreaking: false,
    ...overrides,
  };
}

/** cronの発火時刻。21:00ちょうどとは限らないため数十秒の遅延を持たせておく */
const NOW = new Date('2026-07-25T21:00:30Z');
/** NOWに対応する収集窓 (2026-07-24T21:00Z, 2026-07-25T21:00Z] */
const WINDOW = digestWindowFor(NOW);

const FAVORITE_USER1 = {
  userId: 'user_1',
  owner: 'vercel',
  name: 'next.js',
  fullName: 'vercel/next.js',
};
const FAVORITE_USER2 = { ...FAVORITE_USER1, userId: 'user_2' };

const STRUCTURED = {
  headline: 'Turbopack既定化',
  lede: 'ビルドの既定がTurbopackに切り替わった。',
  lines: ['Turbopackが既定に', 'PPRが安定版に', '画像最適化のメモリを削減'],
  hasBreaking: true,
};

describe('digestWindowFor / digestDayOf', () => {
  it('21:00 UTCちょうどの実行では当日21:00を終端とする24時間窓になる', () => {
    const window = digestWindowFor(new Date('2026-07-25T21:00:00Z'));
    expect(window.end.toISOString()).toBe('2026-07-25T21:00:00.000Z');
    expect(window.start.toISOString()).toBe('2026-07-24T21:00:00.000Z');
    expect(digestDayOf(window)).toBe('2026-07-25');
  });

  it('cronの発火が数分遅れても同じ窓に丸まる', () => {
    const window = digestWindowFor(new Date('2026-07-25T21:03:12Z'));
    expect(window.end.toISOString()).toBe('2026-07-25T21:00:00.000Z');
    expect(digestDayOf(window)).toBe('2026-07-25');
  });

  it('21:00 UTCより前の実行は前日分の窓になる（部分的な当日窓を作らない）', () => {
    const window = digestWindowFor(new Date('2026-07-25T20:59:59Z'));
    expect(window.end.toISOString()).toBe('2026-07-24T21:00:00.000Z');
    expect(window.start.toISOString()).toBe('2026-07-23T21:00:00.000Z');
    expect(digestDayOf(window)).toBe('2026-07-24');
  });
});

describe('releasesInWindow', () => {
  it('終端ちょうどは含み、始端ちょうどは含まない（半開区間）', () => {
    const releases = [
      release({ id: 1, published_at: '2026-07-25T21:00:00Z' }), // 終端ちょうど
      release({ id: 2, published_at: '2026-07-24T21:00:00Z' }), // 始端ちょうど（前日の窓に属する）
      release({ id: 3, published_at: '2026-07-24T21:00:01Z' }),
      release({ id: 4, published_at: null }), // draft
    ];
    expect(releasesInWindow(releases, WINDOW).map((r) => r.id)).toEqual([1, 3]);
  });

  it('21:00-24:00 UTCのリリースは当日の窓には入らず、翌日の窓に入る（負債(c)の回帰）', () => {
    const lateRelease = release({ published_at: '2026-07-25T21:30:00Z' });
    expect(releasesInWindow([lateRelease], WINDOW)).toEqual([]);
    const nextWindow = digestWindowFor(new Date('2026-07-26T21:00:30Z'));
    expect(releasesInWindow([lateRelease], nextWindow)).toEqual([lateRelease]);
  });
});

describe('digestEntriesSchema', () => {
  it('朝刊エントリの配列を受理する（null許容フィールドを含む）', () => {
    const entries = [
      entry({}),
      entry({ releaseName: null, headline: null, summary: null, hasBreaking: null }),
    ];
    expect(digestEntriesSchema.parse(entries)).toEqual(entries);
  });

  it('必須フィールドが欠けた要素・配列以外は拒否する', () => {
    const { tagName: _dropped, ...missingTag } = entry({});
    expect(digestEntriesSchema.safeParse([missingTag]).success).toBe(false);
    expect(digestEntriesSchema.safeParse({ entries: [] }).success).toBe(false);
  });
});

describe('composeDigestOverview', () => {
  it('リポジトリ数・リリース数・破壊的変更数をまとめる', () => {
    const entries = [
      entry({ tagName: 'v1.0.0', hasBreaking: true }),
      entry({ tagName: 'v1.0.1' }),
      entry({ owner: 'prisma', repo: 'prisma', fullName: 'prisma/prisma' }),
    ];
    expect(composeDigestOverview(entries)).toBe('2リポジトリ・3リリース（うち破壊的変更1件）');
  });

  it('破壊的変更が無ければ括弧を付けない', () => {
    expect(composeDigestOverview([entry({})])).toBe('1リポジトリ・1リリース');
  });
});

describe('assembleDigestEntries', () => {
  const repoKey = 'vercel/next.js';

  it('公開日時の新しい順に並べ、要約を各リリースへ対応付ける', () => {
    const releasesByRepo = new Map([
      [
        repoKey,
        [
          release({ tag_name: 'v1.0.0', published_at: '2026-07-25T01:00:00Z' }),
          release({ tag_name: 'v1.1.0', published_at: '2026-07-25T09:00:00Z' }),
        ],
      ],
    ]);
    const summariesByKey = new Map([
      ['vercel/next.js@v1.1.0', { summary: '・要点', headline: '見出し', hasBreaking: true }],
    ]);

    const entries = assembleDigestEntries([FAVORITE_USER1], releasesByRepo, summariesByKey);

    expect(entries.map((e) => e.tagName)).toEqual(['v1.1.0', 'v1.0.0']);
    expect(entries[0]).toMatchObject({ headline: '見出し', summary: '・要点', hasBreaking: true });
    // 要約が無いリリース（本文なし・生成失敗）もリンクのみのエントリとして残る
    expect(entries[1]).toMatchObject({ headline: null, summary: null, hasBreaking: null });
  });

  it('お気に入りに該当リリースが無ければ空になる', () => {
    expect(assembleDigestEntries([FAVORITE_USER1], new Map(), new Map())).toEqual([]);
  });
});

describe('runDailyDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    favoritesFindManyMock.mockResolvedValue([FAVORITE_USER1, FAVORITE_USER2]);
    fetchReleasesMock.mockResolvedValue([release({})]);
    digestFindManyMock.mockResolvedValue([]);
    digestUpsertMock.mockResolvedValue({});
    summaryFindUniqueMock.mockResolvedValue(null);
    summaryUpsertMock.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'rs_1', createdAt: new Date(), ...create })
    );
    generateStructuredMock.mockResolvedValue({
      data: STRUCTURED,
      text: JSON.stringify(STRUCTURED),
      model: 'gemini-2.5-flash',
    });
  });

  it('同一リリースをお気に入りに持つ2ユーザーでも、取得1回・生成1回でダイジェストは2件保存される', async () => {
    const result = await runDailyDigest(NOW);

    // ユニークリポジトリ単位で1リクエスト（24時間窓は先頭1ページで収まる）
    expect(fetchReleasesMock).toHaveBeenCalledTimes(1);
    expect(fetchReleasesMock).toHaveBeenCalledWith('vercel', 'next.js', {
      perPage: 100,
      maxPages: 1,
    });
    // AI呼び出しは新規リリース数にのみ比例（ユーザー数に比例しない）
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);

    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    const keys = digestUpsertMock.mock.calls.map((call) => call[0].where.cacheKey).sort();
    expect(keys).toEqual(['digest:2026-07-25:user_1', 'digest:2026-07-25:user_2']);
    for (const call of digestUpsertMock.mock.calls) {
      expect(call[0].create.date).toEqual(new Date('2026-07-25T00:00:00.000Z'));
      expect(call[0].create.entries).toHaveLength(1);
      expect(call[0].create.entries[0]).toMatchObject({
        fullName: 'vercel/next.js',
        headline: 'Turbopack既定化',
        hasBreaking: true,
      });
      // 組み立て式の新規行はLLM出力（content/model）を持たない
      expect(call[0].create.content).toBeUndefined();
      expect(call[0].create.model).toBeUndefined();
    }
    expect(result.summaries).toEqual({ generated: 1, cached: 0, noteless: 0, failed: 0 });
    expect(result.digests).toEqual({ generated: 2, cached: 0, noActivity: 0, failed: 0 });
  });

  it('既にダイジェストがある日の再実行では何も生成しない', async () => {
    digestFindManyMock.mockResolvedValue([
      { cacheKey: 'digest:2026-07-25:user_1' },
      { cacheKey: 'digest:2026-07-25:user_2' },
    ]);
    summaryFindUniqueMock.mockResolvedValue({
      summary: '・既存要約',
      headline: '既存見出し',
      hasBreaking: false,
    });

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).not.toHaveBeenCalled();
    expect(result.digests).toEqual({ generated: 0, cached: 2, noActivity: 0, failed: 0 });
  });

  it('共有要約が既にあればAIを呼ばず、その見出しがentriesに載る（プレウォームの再利用）', async () => {
    summaryFindUniqueMock.mockResolvedValue({
      summary: '・既存要約',
      headline: '既存見出し',
      hasBreaking: false,
    });

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock.mock.calls[0][0].create.entries[0]).toMatchObject({
      headline: '既存見出し',
      summary: '・既存要約',
      hasBreaking: false,
    });
    expect(result.summaries).toEqual({ generated: 0, cached: 1, noteless: 0, failed: 0 });
  });

  it('本文が空のリリースはAIを呼ばず、リンクのみのエントリとして載る', async () => {
    fetchReleasesMock.mockResolvedValue([release({ body: '' })]);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    expect(digestUpsertMock.mock.calls[0][0].create.entries[0]).toMatchObject({
      summary: null,
      headline: null,
    });
    expect(result.summaries).toEqual({ generated: 0, cached: 0, noteless: 1, failed: 0 });
  });

  it('要約の生成に失敗してもエントリは残り、ダイジェストの保存は止めない', async () => {
    generateStructuredMock.mockRejectedValue(new Error('gemini down'));

    const result = await runDailyDigest(NOW);

    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    expect(digestUpsertMock.mock.calls[0][0].create.entries[0]).toMatchObject({ summary: null });
    expect(result.summaries).toEqual({ generated: 0, cached: 0, noteless: 0, failed: 1 });
    expect(result.digests.generated).toBe(2);
  });

  it('窓内のリリースが無ければ保存しない', async () => {
    fetchReleasesMock.mockResolvedValue([release({ published_at: '2026-07-20T00:00:00Z' })]);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).not.toHaveBeenCalled();
    expect(result.digests).toEqual({ generated: 0, cached: 0, noActivity: 2, failed: 0 });
  });

  it('一部リポジトリの取得失敗は無視して残りで組み立てる', async () => {
    favoritesFindManyMock.mockResolvedValue([
      FAVORITE_USER1,
      { ...FAVORITE_USER1, owner: 'gone', name: 'repo', fullName: 'gone/repo' },
    ]);
    fetchReleasesMock.mockImplementation((owner: string) =>
      owner === 'gone' ? Promise.reject(new Error('boom')) : Promise.resolve([release({})])
    );

    const result = await runDailyDigest(NOW);

    expect(result.repos).toEqual({ total: 2, fetchFailed: 1 });
    expect(digestUpsertMock).toHaveBeenCalledTimes(1);
    expect(digestUpsertMock.mock.calls[0][0].create.entries).toHaveLength(1);
  });

  it('1ユーザーの保存失敗は他ユーザーの朝刊を止めない', async () => {
    digestUpsertMock.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({});

    const result = await runDailyDigest(NOW);

    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    expect(result.digests).toEqual({ generated: 1, cached: 0, noActivity: 0, failed: 1 });
  });

  it('21:00-24:00 UTCのリリースは当日の朝刊には載らず、翌日の朝刊に載る', async () => {
    fetchReleasesMock.mockResolvedValue([release({ published_at: '2026-07-25T21:30:00Z' })]);

    const today = await runDailyDigest(NOW);
    expect(today.digests.noActivity).toBe(2);
    expect(digestUpsertMock).not.toHaveBeenCalled();

    const tomorrow = await runDailyDigest(new Date('2026-07-26T21:00:30Z'));
    expect(tomorrow.digests.generated).toBe(2);
    expect(digestUpsertMock.mock.calls[0][0].where.cacheKey).toBe('digest:2026-07-26:user_1');
  });
});
