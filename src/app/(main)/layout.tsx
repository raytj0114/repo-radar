import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

// (main) 配下は認証必須。未認証は /login へ。DOMは足さない（見た目は配下のlayoutが持つ）
export default async function MainLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  return children;
}
