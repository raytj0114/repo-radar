import type { DefaultSession } from 'next-auth';

// session.user.id を型レベルで保証する（src/lib/auth.ts のcallbacksで設定）
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
  }
}
