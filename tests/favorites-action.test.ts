import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFavorite, importStarredFavorites, removeFavorite } from '@/app/actions/favorites';
import { UnauthorizedError } from '@/lib/require-session';

const {
  authMock,
  upsertMock,
  deleteManyMock,
  createManyMock,
  revalidatePathMock,
  loadStarredMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  loadStarredMock: vi.fn(),
}));

// requireSession は実物を使い、その依存の auth() だけをモックする
// （NextAuth本体はenv/Prismaに依存するためテストでは読み込まない）
vi.mock('@/lib/auth', () => ({ auth: authMock }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    favoriteRepo: { upsert: upsertMock, deleteMany: deleteManyMock, createMany: createManyMock },
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

vi.mock('@/lib/starred', () => ({ loadStarredForUser: loadStarredMock }));

/**
 * お気に入り変更が失効させる面の一覧（revalidateFavoriteViews）。
 * `revalidatePath('/', 'layout')` による全域失効をやめた（#42レビュー指摘3）ため、
 * 「お気に入りが映る面がひとつ漏れなく列挙されているか」を呼び出し列で固定する
 */
function expectFavoriteViewsRevalidated() {
  expect(revalidatePathMock.mock.calls).toEqual([
    ['/'],
    ['/favorites'],
    ['/trending'],
    ['/radio'],
    ['/repos/[owner]/[name]', 'page'],
  ]);
}

describe('addFavorite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
  });

  it('未認証なら UnauthorizedError で失敗し、DBに書き込まない', async () => {
    authMock.mockResolvedValue(null);
    await expect(addFavorite({ owner: 'vercel', name: 'next.js' })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('検証済み入力でupsertする（重複登録に安全）', async () => {
    await addFavorite({ owner: 'vercel', name: 'next.js' });
    expect(upsertMock).toHaveBeenCalledWith({
      where: { userId_owner_name: { userId: 'user_1', owner: 'vercel', name: 'next.js' } },
      create: {
        userId: 'user_1',
        owner: 'vercel',
        name: 'next.js',
        fullName: 'vercel/next.js',
        avatarUrl: null,
      },
      update: {},
    });
    expectFavoriteViewsRevalidated();
  });

  it('不正な入力はZodErrorで失敗し、DBに書き込まない', async () => {
    await expect(addFavorite({ owner: 'a/b', name: 'c' })).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('removeFavorite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
  });

  it('未認証なら UnauthorizedError で失敗する', async () => {
    authMock.mockResolvedValue(null);
    await expect(removeFavorite({ owner: 'vercel', name: 'next.js' })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it('自分のユーザーIDに限定してdeleteManyする（冪等）', async () => {
    await removeFavorite({ owner: 'vercel', name: 'next.js' });
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { userId: 'user_1', owner: 'vercel', name: 'next.js' },
    });
    expectFavoriteViewsRevalidated();
  });
});

describe('importStarredFavorites', () => {
  // canonical casing検証のため、あえて大文字混じりのAPIレスポンスを模す
  const starredRepo = (id: number, login: string, name: string) => ({
    id,
    name,
    full_name: `${login}/${name}`,
    owner: { login, avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    html_url: `https://github.com/${login}/${name}`,
    description: null,
    language: null,
    stargazers_count: 1,
    forks_count: 0,
    open_issues_count: 0,
    pushed_at: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    loadStarredMock.mockResolvedValue({
      status: 'ok',
      login: 'Stargazer',
      repos: [starredRepo(101, 'Vercel', 'Next.js'), starredRepo(102, 'stargazer', 'orbital')],
    });
  });

  it('未認証なら UnauthorizedError で失敗し、取得もDB書き込みもしない', async () => {
    authMock.mockResolvedValue(null);
    await expect(importStarredFavorites({ ids: [101] })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(loadStarredMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('不正な入力（空配列）は invalid-input で失敗し、取得もDB書き込みもしない', async () => {
    await expect(importStarredFavorites({ ids: [] })).resolves.toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    expect(loadStarredMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('上限（300件）を超える入力を拒否する', async () => {
    const ids = Array.from({ length: 301 }, (_, i) => i + 1);
    await expect(importStarredFavorites({ ids })).resolves.toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('選択idに合致する銘柄だけを、APIレスポンスのcanonical表記でcreateManyする', async () => {
    await expect(importStarredFavorites({ ids: [101, 999] })).resolves.toEqual({ ok: true });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user_1',
          owner: 'Vercel',
          name: 'Next.js',
          fullName: 'Vercel/Next.js',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
      ],
      skipDuplicates: true,
    });
    expectFavoriteViewsRevalidated();
  });

  it('スター一覧に無いidだけなら書き込みを省き、成功として扱う（表示後の星外れ等）', async () => {
    await expect(importStarredFavorites({ ids: [999] })).resolves.toEqual({ ok: true });
    expect(createManyMock).not.toHaveBeenCalled();
    expectFavoriteViewsRevalidated();
  });

  it('スター一覧が引けない（no-account等）なら黙って空成功にせず starred-unavailable を返す', async () => {
    loadStarredMock.mockResolvedValue({ status: 'no-account' });
    await expect(importStarredFavorites({ ids: [101] })).resolves.toEqual({
      ok: false,
      reason: 'starred-unavailable',
    });
    expect(createManyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('GitHubの例外（レート上限等）もthrowせず starred-unavailable に丸め、DBに書き込まない', async () => {
    // throwすると面ごとerror境界に落ち、本番ではメッセージもマスクされる（#42レビュー指摘2）
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadStarredMock.mockRejectedValue(new Error('rate limited'));
    await expect(importStarredFavorites({ ids: [101] })).resolves.toEqual({
      ok: false,
      reason: 'starred-unavailable',
    });
    expect(createManyMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
