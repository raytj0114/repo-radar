import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReleaseSummary } from '@/app/actions/summaries';
import { UnauthorizedError } from '@/lib/require-session';

const {
  authMock,
  findUniqueMock,
  upsertMock,
  fetchRepositoryMock,
  fetchReleaseByTagMock,
  generateTextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  fetchRepositoryMock: vi.fn(),
  fetchReleaseByTagMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));

vi.mock('@/lib/prisma', () => ({
  prisma: { releaseSummary: { findUnique: findUniqueMock, upsert: upsertMock } },
}));

// エラークラスは実物を保ち、fetch系のみモックする
vi.mock('@/lib/github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/github/client')>()),
  fetchRepository: fetchRepositoryMock,
  fetchReleaseByTag: fetchReleaseByTagMock,
}));

vi.mock('@/lib/gemini/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini/client')>()),
  generateText: generateTextMock,
}));

const INPUT = { owner: 'vercel', name: 'next.js', tagName: 'v16.2.0' };

const REPO = {
  full_name: 'vercel/next.js',
  name: 'next.js',
  owner: { login: 'vercel' },
};

const RELEASE = {
  tag_name: 'v16.2.0',
  name: 'v16.2.0',
  body: '## Changes\n- Fixed a bug',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  authMock.mockResolvedValue({ user: { id: 'user_1' } });
  findUniqueMock.mockResolvedValue(null);
  fetchRepositoryMock.mockResolvedValue(REPO);
  fetchReleaseByTagMock.mockResolvedValue(RELEASE);
  generateTextMock.mockResolvedValue({ text: '・要約', model: 'gemini-2.5-flash' });
  upsertMock.mockImplementation(({ create }) => Promise.resolve(create));
});

describe('getReleaseSummary', () => {
  it('未認証なら UnauthorizedError で失敗し、何も呼ばない', async () => {
    authMock.mockResolvedValue(null);
    await expect(getReleaseSummary(INPUT)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('キャッシュヒット時はGeminiもGitHubも呼ばずに即返す', async () => {
    findUniqueMock.mockResolvedValue({ summary: 'キャッシュ済み要約' });
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: true, summary: 'キャッシュ済み要約' });
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { cacheKey: 'vercel/next.js@v16.2.0' },
    });
    expect(fetchRepositoryMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('キャッシュミス時はGitHubから引き直してGeminiを1回だけ呼び、保存してから返す', async () => {
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: true, summary: '・要約' });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    // プロンプトにはGitHub APIの canonical な full_name が使われる
    expect(generateTextMock.mock.calls[0][0]).toContain('リポジトリ: vercel/next.js');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cacheKey: 'vercel/next.js@v16.2.0' },
        create: expect.objectContaining({
          cacheKey: 'vercel/next.js@v16.2.0',
          owner: 'vercel',
          repo: 'next.js',
          summary: '・要約',
          model: 'gemini-2.5-flash',
        }),
      })
    );
  });

  it('cacheKeyはowner/repoを小文字に正規化する（大文字入力でも同一キャッシュ）', async () => {
    findUniqueMock.mockResolvedValue({ summary: '既存' });
    await getReleaseSummary({ owner: 'Vercel', name: 'Next.js', tagName: 'v16.2.0' });
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { cacheKey: 'vercel/next.js@v16.2.0' },
    });
  });

  it('不正な入力は拒否し、DBにもAPIにも触れない', async () => {
    const result = await getReleaseSummary({ owner: 'a/b', name: 'c', tagName: 'v1 ' });
    expect(result).toEqual({ ok: false, message: '入力が不正です' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('リリースが見つからない場合はGeminiを呼ばない', async () => {
    fetchReleaseByTagMock.mockResolvedValue(null);
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: false, message: 'リリースが見つかりませんでした' });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('リリースノートが空ならGeminiを呼ばない', async () => {
    fetchReleaseByTagMock.mockResolvedValue({ ...RELEASE, body: '  ' });
    const result = await getReleaseSummary(INPUT);
    expect(result.ok).toBe(false);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('保存に失敗したら生成結果を返さない（キャッシュ迂回経路を作らない）', async () => {
    upsertMock.mockRejectedValue(new Error('db down'));
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: false, message: '要約の生成に失敗しました' });
  });

  it('Geminiのレート超過はユーザー向けメッセージで返す', async () => {
    const { GeminiAPIError } = await import('@/lib/gemini/client');
    generateTextMock.mockRejectedValue(
      new GeminiAPIError(429, 'しばらく時間をおいて再試行してください')
    );
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: false, message: 'しばらく時間をおいて再試行してください' });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
