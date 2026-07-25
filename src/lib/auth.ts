import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';

// JWT戦略 + PrismaAdapter。AdapterはUser/Accountの永続化のみに使い、
// Sessionテーブルは持たない（docs/ARCHITECTURE.md「DB スキーマ方針」）。
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  secret: env.AUTH_SECRET,
  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    jwt({ token, user }) {
      // user は初回サインイン時のみ渡される。DB上のUser.idをトークンに載せる
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === 'string') {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
