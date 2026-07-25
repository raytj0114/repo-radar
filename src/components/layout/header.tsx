import Image from 'next/image';
import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';

export async function Header() {
  const session = await auth();

  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          RepoRadar
        </Link>
        {session?.user ? (
          <div className="flex items-center gap-3">
            {session.user.image && (
              <Image
                src={session.user.image}
                alt=""
                width={28}
                height={28}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-gray-700">{session.user.name}</span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button type="submit" className="text-sm text-gray-500 hover:text-gray-900">
                ログアウト
              </button>
            </form>
          </div>
        ) : (
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900">
            ログイン
          </Link>
        )}
      </div>
    </header>
  );
}
