import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { requireSession, UnauthorizedError } from '@/lib/require-session';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

// NextAuth本体（env・Prismaに依存）を読み込まないよう auth() だけをモックする
vi.mock('@/lib/auth', () => ({ auth: authMock }));

function makeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: { id: 'user_1', name: 'octocat', email: 'octo@example.com', image: null, ...overrides },
    expires: '2999-01-01T00:00:00.000Z',
  } as Session;
}

describe('requireSession', () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it('認証済みならセッションをそのまま返す', async () => {
    const session = makeSession();
    authMock.mockResolvedValue(session);
    await expect(requireSession()).resolves.toBe(session);
  });

  it('未認証（session=null）なら UnauthorizedError を投げる', async () => {
    authMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('セッションに user.id が無ければ UnauthorizedError を投げる', async () => {
    authMock.mockResolvedValue({
      user: { name: 'ghost' },
      expires: '2999-01-01T00:00:00.000Z',
    });
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
