import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth, signIn } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'ログイン',
};

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect('/');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">RepoRadar</h1>
        <p className="mt-2 text-sm text-gray-600">
          GitHubリポジトリのリリースを追跡し、AIが日本語で要約します
        </p>
      </div>
      <form
        action={async () => {
          'use server';
          await signIn('github', { redirectTo: '/' });
        }}
      >
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          GitHubでログイン
        </button>
      </form>
    </main>
  );
}
