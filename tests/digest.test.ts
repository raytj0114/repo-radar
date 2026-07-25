import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDailyDigest, releasesPublishedOn } from '@/lib/digest';
import type { Release } from '@/lib/github/schemas';

const {
  digestFindUniqueMock,
  digestUpsertMock,
  favoritesFindManyMock,
  fetchReleasesMock,
  generateTextMock,
} = vi.hoisted(() => ({
  digestFindUniqueMock: vi.fn(),
  digestUpsertMock: vi.fn(),
  favoritesFindManyMock: vi.fn(),
  fetchReleasesMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyDigest: { findUnique: digestFindUniqueMock, upsert: digestUpsertMock },
    favoriteRepo: { findMany: favoritesFindManyMock },
  },
}));

vi.mock('@/lib/github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/github/client')>()),
  fetchReleases: fetchReleasesMock,
}));

vi.mock('@/lib/gemini/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini/client')>()),
  generateText: generateTextMock,
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

const DATE = new Date('2026-07-25T21:00:00Z');
const FAVORITE = { userId: 'user_1', owner: 'vercel', name: 'next.js', fullName: 'vercel/next.js' };

describe('releasesPublishedOn', () => {
  it('UTC日付が一致するリリースのみ抽出する', () => {
    const releases = [
      release({ id: 1, published_at: '2026-07-25T00:00:01Z' }),
      release({ id: 2, published_at: '2026-07-24T23:59:59Z' }),
      release({ id: 3, published_at: '2026-07-25T23:59:59Z' }),
      release({ id: 4, published_at: null }),
    ];
    expect(releasesPublishedOn(releases, DATE).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe('generateDailyDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    digestFindUniqueMock.mockResolvedValue(null);
    favoritesFindManyMock.mockResolvedValue([FAVORITE]);
    fetchReleasesMock.mockResolvedValue([release({})]);
    generateTextMock.mockResolvedValue({ text: 'ダイジェスト本文', model: 'gemini-2.5-flash' });
    digestUpsertMock.mockResolvedValue({});
  });

  it('キャッシュヒット時はGeminiもGitHubも呼ばない', async () => {
    digestFindUniqueMock.mockResolvedValue({ id: 'x' });
    await expect(generateDailyDigest('user_1', DATE)).resolves.toBe('cached');
    expect(digestFindUniqueMock).toHaveBeenCalledWith({
      where: { cacheKey: 'digest:2026-07-25:user_1' },
    });
    expect(fetchReleasesMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('お気に入りが無ければ何もしない', async () => {
    favoritesFindManyMock.mockResolvedValue([]);
    await expect(generateDailyDigest('user_1', DATE)).resolves.toBe('no-favorites');
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('当日リリースが無ければGeminiを呼ばず、保存もしない', async () => {
    fetchReleasesMock.mockResolvedValue([release({ published_at: '2026-07-20T00:00:00Z' })]);
    await expect(generateDailyDigest('user_1', DATE)).resolves.toBe('no-activity');
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(digestUpsertMock).not.toHaveBeenCalled();
  });

  it('当日リリースがあればGeminiを1回呼び、UTC日付キーで保存する', async () => {
    await expect(generateDailyDigest('user_1', DATE)).resolves.toBe('generated');
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0][0]).toContain('vercel/next.js');
    expect(digestUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cacheKey: 'digest:2026-07-25:user_1' },
        create: expect.objectContaining({
          cacheKey: 'digest:2026-07-25:user_1',
          userId: 'user_1',
          date: new Date('2026-07-25T00:00:00.000Z'),
          content: 'ダイジェスト本文',
          model: 'gemini-2.5-flash',
        }),
      })
    );
  });

  it('一部リポジトリの取得失敗は無視して残りで生成する', async () => {
    favoritesFindManyMock.mockResolvedValue([
      FAVORITE,
      { ...FAVORITE, owner: 'gone', name: 'repo', fullName: 'gone/repo' },
    ]);
    fetchReleasesMock.mockImplementation((owner: string) =>
      owner === 'gone' ? Promise.reject(new Error('boom')) : Promise.resolve([release({})])
    );
    await expect(generateDailyDigest('user_1', DATE)).resolves.toBe('generated');
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });
});
