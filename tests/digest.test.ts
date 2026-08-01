import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assembleDigestEntries,
  compareDigestEntries,
  composeDigestOverview,
  digestDayOf,
  digestEntriesSchema,
  digestWindowFor,
  digestWindowsFor,
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
    noteless: false,
    ...overrides,
  };
}

/** cronの発火時刻。21:00ちょうどとは限らないため数十秒の遅延を持たせておく */
const NOW = new Date('2026-07-25T21:00:30Z');
/** NOWに対応する当日窓 (2026-07-24T21:00Z, 2026-07-25T21:00Z] */
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

/** 既存要約（プール済み）の行。summaryFindUniqueMock で返す */
const POOLED_SUMMARY = {
  summary: '・既存要約',
  headline: '既存見出し',
  lede: null,
  hasBreaking: false,
};

/** 既定フィクスチャ（vercel/next.js v1.0.0 + POOLED_SUMMARY）から組み立てた期待エントリ */
function pooledEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return entry({
    headline: POOLED_SUMMARY.headline,
    summary: POOLED_SUMMARY.summary,
    hasBreaking: POOLED_SUMMARY.hasBreaking,
    ...overrides,
  });
}

describe('digestWindowFor / digestWindowsFor / digestDayOf', () => {
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

  it('digestWindowsForは前日窓+当日窓を古い順に、隙間なく返す（バックフィル用）', () => {
    const [previous, current] = digestWindowsFor(NOW);
    expect(previous.start.toISOString()).toBe('2026-07-23T21:00:00.000Z');
    expect(previous.end.toISOString()).toBe('2026-07-24T21:00:00.000Z');
    expect(current.start.toISOString()).toBe('2026-07-24T21:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-07-25T21:00:00.000Z');
    expect(previous.end.getTime()).toBe(current.start.getTime());
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

  it('notelessの無い#36以前のエントリも受理する（後方互換）', () => {
    const { noteless: _dropped, ...legacyEntry } = entry({});
    expect(digestEntriesSchema.safeParse([legacyEntry]).success).toBe(true);
  });

  it('ledeの無い#31以前のエントリも、lede付きのエントリも受理する（後方互換）', () => {
    const { lede: _dropped, ...legacyEntry } = entry({ lede: null });
    expect(digestEntriesSchema.safeParse([legacyEntry]).success).toBe(true);
    expect(digestEntriesSchema.safeParse([entry({ lede: '前文の一段落。' })]).success).toBe(true);
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
      [
        'vercel/next.js@v1.1.0',
        { summary: '・要点', headline: '見出し', lede: '前文の一段落。', hasBreaking: true },
      ],
    ]);

    const entries = assembleDigestEntries([FAVORITE_USER1], releasesByRepo, summariesByKey);

    expect(entries.map((e) => e.tagName)).toEqual(['v1.1.0', 'v1.0.0']);
    expect(entries[0]).toMatchObject({
      headline: '見出し',
      lede: '前文の一段落。',
      summary: '・要点',
      hasBreaking: true,
    });
    // 要約が無いリリース（生成失敗）もリンクのみのエントリとして残る。本文ありなので noteless=false
    expect(entries[1]).toMatchObject({
      headline: null,
      summary: null,
      hasBreaking: null,
      noteless: false,
    });
  });

  it('本文が空のリリースは noteless=true になる（「リリースノートなし」と生成失敗の区別）', () => {
    const releasesByRepo = new Map([[repoKey, [release({ body: '' })]]]);
    const entries = assembleDigestEntries([FAVORITE_USER1], releasesByRepo, new Map());
    expect(entries[0]).toMatchObject({ summary: null, noteless: true });
  });

  it('ケース違いで同じリポジトリを二重お気に入りしていてもエントリは1回だけ（Issue #36 指摘4）', () => {
    const caseVariant = {
      userId: 'user_1',
      owner: 'Vercel',
      name: 'Next.js',
      fullName: 'Vercel/Next.js',
    };
    const releasesByRepo = new Map([[repoKey, [release({})]]]);
    const entries = assembleDigestEntries([FAVORITE_USER1, caseVariant], releasesByRepo, new Map());
    expect(entries).toHaveLength(1);
  });

  it('お気に入りに該当リリースが無ければ空になる', () => {
    expect(assembleDigestEntries([FAVORITE_USER1], new Map(), new Map())).toEqual([]);
  });
});

describe('compareDigestEntries', () => {
  it('内容が同じなら並び順・notelessの欠落表現が違っても equal', () => {
    const a = entry({ tagName: 'v1.0.0' });
    const b = entry({ tagName: 'v1.1.0' });
    const { noteless: _dropped, ...aWithoutNoteless } = entry({ tagName: 'v1.0.0' });
    expect(compareDigestEntries([a, b], [b, a])).toBe('equal');
    // jsonbのキー順に依存しないことの代表として、undefinedとフィールド欠落を同一視する
    expect(
      compareDigestEntries([aWithoutNoteless], [entry({ tagName: 'v1.0.0', noteless: undefined })])
    ).toBe('equal');
  });

  it('要約がnullから埋まる・エントリが増える変化は improved', () => {
    const degraded = entry({ summary: null, headline: null });
    expect(compareDigestEntries([degraded], [entry({})])).toBe('improved');
    expect(compareDigestEntries([entry({})], [entry({}), entry({ tagName: 'v1.1.0' })])).toBe(
      'improved'
    );
  });

  it('旧entriesにledeが加わる変化は improved（#31追加分はバックフィルで自動補完される）', () => {
    const { lede: _dropped, ...before } = entry({ lede: null });
    expect(compareDigestEntries([before as DigestEntry], [entry({ lede: '前文の一段落。' })])).toBe(
      'improved'
    );
    // ledeの欠落とnullは同一視する（jsonbのキー欠落で無限にimprovedし続けない）
    expect(compareDigestEntries([before as DigestEntry], [entry({ lede: null })])).toBe('equal');
  });

  it('リリースの消失・要約の後退（非null→null）は regressed', () => {
    expect(compareDigestEntries([entry({}), entry({ tagName: 'v9.9.9' })], [entry({})])).toBe(
      'regressed'
    );
    expect(compareDigestEntries([entry({})], [entry({ summary: null })])).toBe('regressed');
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

  /** 既存ダイジェスト行をcacheKeyで返すようにする（窓ごとの2回のfindManyに対応） */
  function seedExistingDigests(
    rows: { cacheKey: string; entries: unknown; content?: string | null }[]
  ) {
    digestFindManyMock.mockImplementation(({ where }: { where: { cacheKey: { in: string[] } } }) =>
      Promise.resolve(
        rows
          .filter((row) => where.cacheKey.in.includes(row.cacheKey))
          .map((row) => ({ content: null, ...row }))
      )
    );
  }

  it('同一リリースをお気に入りに持つ2ユーザーでも、取得1回・生成1回でダイジェストは2件保存される', async () => {
    const result = await runDailyDigest(NOW);

    // ユニークリポジトリ単位で1リクエスト。cron経路はfetchキャッシュを踏まない（fresh）
    expect(fetchReleasesMock).toHaveBeenCalledTimes(1);
    expect(fetchReleasesMock).toHaveBeenCalledWith('vercel', 'next.js', {
      perPage: 100,
      maxPages: 1,
      fresh: true,
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
        noteless: false,
      });
      // 組み立て式の新規行はLLM出力（content/model）を持たない
      expect(call[0].create.content).toBeUndefined();
      expect(call[0].create.model).toBeUndefined();
    }
    expect(result.summaries).toEqual({ generated: 1, cached: 0, noteless: 0, failed: 0 });
    // 当日窓は2ユーザー分created、前日窓は窓内リリースなし
    expect(result.windows[1]).toEqual({
      date: '2026-07-25',
      digests: { created: 2, repaired: 0, unchanged: 0, kept: 0, noActivity: 0, failed: 0 },
    });
    expect(result.windows[0].date).toBe('2026-07-24');
    expect(result.windows[0].digests.noActivity).toBe(2);
  });

  it('ケース違いのお気に入りを持つ2ユーザーでも取得1回・生成1回に重複排除される（レビュアー推奨の回帰）', async () => {
    favoritesFindManyMock.mockResolvedValue([
      FAVORITE_USER1,
      { userId: 'user_2', owner: 'Vercel', name: 'Next.js', fullName: 'Vercel/Next.js' },
    ]);

    const result = await runDailyDigest(NOW);

    expect(fetchReleasesMock).toHaveBeenCalledTimes(1);
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    // 各ユーザーのエントリは自分のお気に入りの表記で載る
    const fullNames = digestUpsertMock.mock.calls.map((call) => call[0].create.entries[0].fullName);
    expect(fullNames.sort()).toEqual(['Vercel/Next.js', 'vercel/next.js']);
    expect(result.summaries.generated).toBe(1);
  });

  it('前回と完全一致する再実行では書き込みもAI呼び出しも発生しない（冪等）', async () => {
    summaryFindUniqueMock.mockResolvedValue(POOLED_SUMMARY);
    seedExistingDigests([
      { cacheKey: 'digest:2026-07-25:user_1', entries: [pooledEntry()] },
      { cacheKey: 'digest:2026-07-25:user_2', entries: [pooledEntry()] },
    ]);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).not.toHaveBeenCalled();
    expect(result.windows[1].digests).toEqual({
      created: 0,
      repaired: 0,
      unchanged: 2,
      kept: 0,
      noActivity: 0,
      failed: 0,
    });
  });

  it('要約がnullのまま焼き付いた朝刊は、要約が得られた再実行で上書き修復される（Issue #36 指摘2）', async () => {
    summaryFindUniqueMock.mockResolvedValue(POOLED_SUMMARY);
    seedExistingDigests([
      {
        cacheKey: 'digest:2026-07-25:user_1',
        entries: [pooledEntry({ summary: null, headline: null, hasBreaking: null })],
      },
      { cacheKey: 'digest:2026-07-25:user_2', entries: [pooledEntry()] },
    ]);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).toHaveBeenCalledTimes(1);
    expect(digestUpsertMock.mock.calls[0][0].where.cacheKey).toBe('digest:2026-07-25:user_1');
    expect(digestUpsertMock.mock.calls[0][0].update.entries[0]).toMatchObject({
      summary: POOLED_SUMMARY.summary,
      headline: POOLED_SUMMARY.headline,
    });
    expect(result.windows[1].digests).toEqual({
      created: 0,
      repaired: 1,
      unchanged: 1,
      kept: 0,
      noActivity: 0,
      failed: 0,
    });
  });

  it('再実行でリリースが欠ける（取得失敗など）場合は配達済みの朝刊を保持する', async () => {
    summaryFindUniqueMock.mockResolvedValue(POOLED_SUMMARY);
    seedExistingDigests([
      {
        cacheKey: 'digest:2026-07-25:user_1',
        entries: [pooledEntry(), pooledEntry({ tagName: 'v9.9.9', releaseName: 'v9.9.9' })],
      },
    ]);
    favoritesFindManyMock.mockResolvedValue([FAVORITE_USER1]);

    const result = await runDailyDigest(NOW);

    expect(digestUpsertMock).not.toHaveBeenCalled();
    expect(result.windows[1].digests.kept).toBe(1);
  });

  it('#30以前の旧形式行（contentのみ）は決して上書きしない', async () => {
    seedExistingDigests([
      { cacheKey: 'digest:2026-07-25:user_1', entries: null, content: '旧形式のテキスト' },
    ]);
    favoritesFindManyMock.mockResolvedValue([FAVORITE_USER1]);

    const result = await runDailyDigest(NOW);

    expect(digestUpsertMock).not.toHaveBeenCalled();
    expect(result.windows[1].digests.kept).toBe(1);
  });

  it('前日窓のダイジェストが無ければバックフィルで作成される（Issue #36 指摘1）', async () => {
    fetchReleasesMock.mockResolvedValue([release({ published_at: '2026-07-24T10:00:00Z' })]);
    favoritesFindManyMock.mockResolvedValue([FAVORITE_USER1]);

    const result = await runDailyDigest(NOW);

    expect(digestUpsertMock).toHaveBeenCalledTimes(1);
    expect(digestUpsertMock.mock.calls[0][0].where.cacheKey).toBe('digest:2026-07-24:user_1');
    expect(digestUpsertMock.mock.calls[0][0].create.date).toEqual(
      new Date('2026-07-24T00:00:00.000Z')
    );
    expect(result.windows[0].digests.created).toBe(1);
    expect(result.windows[1].digests.noActivity).toBe(1);
  });

  it('共有要約が既にあればAIを呼ばず、その見出しがentriesに載る（プレウォームの再利用）', async () => {
    summaryFindUniqueMock.mockResolvedValue(POOLED_SUMMARY);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock.mock.calls[0][0].create.entries[0]).toMatchObject({
      headline: '既存見出し',
      summary: '・既存要約',
      hasBreaking: false,
    });
    expect(result.summaries).toEqual({ generated: 0, cached: 1, noteless: 0, failed: 0 });
  });

  it('本文が空のリリースはAIを呼ばず、noteless=trueのエントリとして載る', async () => {
    fetchReleasesMock.mockResolvedValue([release({ body: '' })]);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    expect(digestUpsertMock.mock.calls[0][0].create.entries[0]).toMatchObject({
      summary: null,
      headline: null,
      noteless: true,
    });
    expect(result.summaries).toEqual({ generated: 0, cached: 0, noteless: 1, failed: 0 });
  });

  it('要約の生成に失敗してもnoteless=falseのエントリが残り、保存は止めない', async () => {
    generateStructuredMock.mockRejectedValue(new Error('gemini down'));

    const result = await runDailyDigest(NOW);

    expect(digestUpsertMock).toHaveBeenCalledTimes(2);
    expect(digestUpsertMock.mock.calls[0][0].create.entries[0]).toMatchObject({
      summary: null,
      noteless: false,
    });
    expect(result.summaries).toEqual({ generated: 0, cached: 0, noteless: 0, failed: 1 });
    expect(result.windows[1].digests.created).toBe(2);
  });

  it('48時間の窓内にリリースが無ければ何も保存しない', async () => {
    fetchReleasesMock.mockResolvedValue([release({ published_at: '2026-07-20T00:00:00Z' })]);

    const result = await runDailyDigest(NOW);

    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).not.toHaveBeenCalled();
    expect(result.windows[0].digests.noActivity).toBe(2);
    expect(result.windows[1].digests.noActivity).toBe(2);
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
    expect(result.windows[1].digests).toEqual({
      created: 1,
      repaired: 0,
      unchanged: 0,
      kept: 0,
      noActivity: 0,
      failed: 1,
    });
  });

  it('21:00-24:00 UTCのリリースは当日の朝刊には載らず、翌日の朝刊に載る', async () => {
    fetchReleasesMock.mockResolvedValue([release({ published_at: '2026-07-25T21:30:00Z' })]);
    favoritesFindManyMock.mockResolvedValue([FAVORITE_USER1]);

    const today = await runDailyDigest(NOW);
    expect(today.windows[1].digests.noActivity).toBe(1);
    expect(digestUpsertMock).not.toHaveBeenCalled();

    const tomorrow = await runDailyDigest(new Date('2026-07-26T21:00:30Z'));
    expect(tomorrow.windows[1].digests.created).toBe(1);
    expect(digestUpsertMock.mock.calls[0][0].where.cacheKey).toBe('digest:2026-07-26:user_1');
  });
});
