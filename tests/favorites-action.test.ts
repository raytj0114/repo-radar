import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFavorite, removeFavorite } from '@/app/actions/favorites';
import { UnauthorizedError } from '@/lib/require-session';

const { authMock, upsertMock, deleteManyMock, revalidatePathMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

// requireSession は実物を使い、その依存の auth() だけをモックする
// （NextAuth本体はenv/Prismaに依存するためテストでは読み込まない）
vi.mock('@/lib/auth', () => ({ auth: authMock }));

vi.mock('@/lib/prisma', () => ({
  prisma: { favoriteRepo: { upsert: upsertMock, deleteMany: deleteManyMock } },
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

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
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout');
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
  });
});
