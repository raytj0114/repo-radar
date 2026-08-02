import Image from 'next/image';
import Link from 'next/link';
import { signOutAction } from '@/app/actions/auth';
import { auth } from '@/lib/auth';
import { MobileNav } from './mobile-nav';
import { navItems } from './nav-items';

export async function Header() {
  const session = await auth();

  return (
    // モバイルメニューのパネルをheader基準で配置するためrelative
    <header className="relative z-40 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            RepoRadar
          </Link>
          {session?.user && (
            <nav className="hidden items-center gap-4 text-sm text-gray-600 md:flex">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-gray-900">
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
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
            <span className="hidden text-sm text-gray-700 md:inline">{session.user.name}</span>
            <form className="hidden md:block" action={signOutAction}>
              <button type="submit" className="text-sm text-gray-500 hover:text-gray-900">
                ログアウト
              </button>
            </form>
            <MobileNav signOutAction={signOutAction} />
          </div>
        ) : (
          <Link
            href="/login"
            className="flex h-11 items-center text-sm text-gray-500 hover:text-gray-900"
          >
            ログイン
          </Link>
        )}
      </div>
    </header>
  );
}
