import type { ReactNode } from 'react';
import { Header } from '@/components/layout/header';

// 従来UIの画面群（trending/digest/repos）。グローバルヘッダー + 中央寄せコンテナ。
// /（紙面）はこのグループの外で全画面を使う（Issue #31）
export default function ChromeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <div className="mx-auto w-full max-w-3xl px-4 py-8">{children}</div>
    </>
  );
}
