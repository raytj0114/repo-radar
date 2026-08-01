import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReleaseSummary } from '@/app/actions/summaries';
import { RELEASE_SUMMARY_PROMPT_VERSION } from '@/lib/gemini/structured';
import { UnauthorizedError } from '@/lib/require-session';

const {
  authMock,
  findUniqueMock,
  upsertMock,
  fetchRepositoryMock,
  fetchReleaseByTagMock,
  generateStructuredMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  fetchRepositoryMock: vi.fn(),
  fetchReleaseByTagMock: vi.fn(),
  generateStructuredMock: vi.fn(),
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
  generateStructured: generateStructuredMock,
}));

const INPUT = { owner: 'vercel', name: 'next.js', tagName: 'v16.2.0' };

const STRUCTURED = {
  headline: 'Turbopack既定化',
  lede: 'ビルドの既定がTurbopackに切り替わった。',
  lines: ['Turbopackが既定に', 'PPRが安定版に', '画像最適化のメモリを削減'],
  hasBreaking: true,
};

const SUMMARY_TEXT = '・Turbopackが既定に\n・PPRが安定版に\n・画像最適化のメモリを削減';

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
  generateStructuredMock.mockResolvedValue({
    data: STRUCTURED,
    text: JSON.stringify(STRUCTURED),
    model: 'gemini-2.5-flash',
  });
  upsertMock.mockImplementation(({ create }) => Promise.resolve(create));
});

describe('getReleaseSummary', () => {
  it('未認証なら UnauthorizedError で失敗し、何も呼ばない', async () => {
    authMock.mockResolvedValue(null);
    await expect(getReleaseSummary(INPUT)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it('キャッシュヒット時はGeminiもGitHubも呼ばずに即返す', async () => {
    findUniqueMock.mockResolvedValue({
      summary: SUMMARY_TEXT,
      headline: 'Turbopack既定化',
      lede: 'ビルドの既定が切り替わった。',
      hasBreaking: true,
    });
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({
      ok: true,
      summary: SUMMARY_TEXT,
      headline: 'Turbopack既定化',
      lede: 'ビルドの既定が切り替わった。',
      hasBreaking: true,
    });
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { cacheKey: 'vercel/next.js@v16.2.0' },
    });
    expect(fetchRepositoryMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('構造化以前のキャッシュ行は見出し無しのまま返す（表示側でフォールバック）', async () => {
    findUniqueMock.mockResolvedValue({
      summary: '・旧要約',
      headline: null,
      lede: null,
      hasBreaking: null,
    });
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({
      ok: true,
      summary: '・旧要約',
      headline: null,
      lede: null,
      hasBreaking: false,
    });
  });

  it('キャッシュミス時はGitHubから引き直してGeminiを1回だけ呼び、保存してから返す', async () => {
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({
      ok: true,
      summary: SUMMARY_TEXT,
      headline: 'Turbopack既定化',
      lede: 'ビルドの既定がTurbopackに切り替わった。',
      hasBreaking: true,
    });
    // 見出し・前文・破壊的変更フラグを足しても呼び出しは1回のまま
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    // プロンプトにはGitHub APIの canonical な full_name が使われる
    expect(generateStructuredMock.mock.calls[0][0]).toContain('リポジトリ: vercel/next.js');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cacheKey: 'vercel/next.js@v16.2.0' },
        create: expect.objectContaining({
          cacheKey: 'vercel/next.js@v16.2.0',
          owner: 'vercel',
          repo: 'next.js',
          summary: SUMMARY_TEXT,
          headline: 'Turbopack既定化',
          lede: 'ビルドの既定がTurbopackに切り替わった。',
          hasBreaking: true,
          promptVersion: RELEASE_SUMMARY_PROMPT_VERSION,
          model: 'gemini-2.5-flash',
        }),
      })
    );
  });

  it('構造化に失敗したらテキストのみで縮退保存する', async () => {
    generateStructuredMock.mockResolvedValue({
      data: null,
      text: '・要約1\n・要約2',
      model: 'gemini-2.5-flash-lite',
    });

    const result = await getReleaseSummary(INPUT);

    expect(result).toEqual({
      ok: true,
      summary: '・要約1\n・要約2',
      headline: null,
      lede: null,
      hasBreaking: false,
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          summary: '・要約1\n・要約2',
          headline: null,
          lede: null,
          hasBreaking: null,
          promptVersion: RELEASE_SUMMARY_PROMPT_VERSION,
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
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it('リリースノートが空ならGeminiを呼ばない', async () => {
    fetchReleaseByTagMock.mockResolvedValue({ ...RELEASE, body: '  ' });
    const result = await getReleaseSummary(INPUT);
    expect(result.ok).toBe(false);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it('保存に失敗したら生成結果を返さない（キャッシュ迂回経路を作らない）', async () => {
    upsertMock.mockRejectedValue(new Error('db down'));
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: false, message: '要約の生成に失敗しました' });
  });

  it('Geminiのレート超過はユーザー向けメッセージで返す', async () => {
    const { GeminiAPIError } = await import('@/lib/gemini/client');
    generateStructuredMock.mockRejectedValue(
      new GeminiAPIError(429, 'しばらく時間をおいて再試行してください')
    );
    const result = await getReleaseSummary(INPUT);
    expect(result).toEqual({ ok: false, message: 'しばらく時間をおいて再試行してください' });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
