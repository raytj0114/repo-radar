import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';

export class UnauthorizedError extends Error {
  constructor() {
    super('認証が必要です');
    this.name = 'UnauthorizedError';
  }
}

/**
 * Server Action / Route Handler の冒頭で必ず呼ぶ認証ガード（CLAUDE.md 不変条件1）。
 * 未認証（またはセッションにuser.idが無い）なら UnauthorizedError を投げる。
 */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session;
}
