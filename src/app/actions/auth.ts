'use server';

import { signOut } from '@/lib/auth';

/**
 * ログアウト（自セッションの破棄のみで副作用なし。公開エンドポイント一覧に記載済み）。
 * ヘッダーのフォーム・モバイルメニュー・紙面の奥付で同じServer Actionを共有する（Issue #31）
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
