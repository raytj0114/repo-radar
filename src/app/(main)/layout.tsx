import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

// (main) 配下は認証必須。未認証は /login へ
export default async function MainLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  return <div className="mx-auto w-full max-w-3xl px-4 py-8">{children}</div>;
}
