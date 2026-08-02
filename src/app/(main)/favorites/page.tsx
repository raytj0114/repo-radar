import Link from 'next/link';
import type { Metadata } from 'next';
import { signOutAction } from '@/app/actions/auth';
import {
  SubscriptionBody,
  type QueryState,
} from '@/components/features/favorites/subscription-body';
import { SubscriptionMasthead } from '@/components/features/favorites/subscription-masthead';
import paperStyles from '@/components/features/paper/paper.module.css';
import { auth } from '@/lib/auth';
import { paperDateFor } from '@/lib/paper';
import { repoSearchQuerySchema } from '@/lib/subscription-input';

// 購読面も紙面の一部なので、テンプレート（%s | RepoRadar）を使わない（一面・深夜放送と同じ）
export const metadata: Metadata = {
  title: { absolute: '購読面｜日刊 RepoRadar' },
};

/**
 * 検索語（GETクエリ）の検証。空文字・空白のみは「未検索」に倒し、
 * 形式不正だけを invalid として紙面調の案内に落とす（エラー画面にしない）
 */
function queryStateOf(q: string | string[] | undefined): QueryState {
  if (q === undefined) return { kind: 'none' };
  if (typeof q !== 'string') return { kind: 'invalid' };
  if (q.trim() === '') return { kind: 'none' };
  const parsed = repoSearchQuerySchema.safeParse(q);
  return parsed.success ? { kind: 'valid', term: parsed.data } : { kind: 'invalid' };
}

/**
 * 購読面（Issue #42）: 購読台帳・銘柄検索・星取帳の三欄。
 * 紙面意匠の全画面統一（Issue #41）のパイロット。
 *
 * 一面と違い、本文を**Suspenseでストリーミングしない**（意図的な設計判断）:
 * この面は同一ページのServer Action（購読・解約・取り込み）で毎回再レンダーされるが、
 * Next 16.2 では「Suspense中の境界を含むページ」へのaction応答ストリームが正常終了せず、
 * クライアントが更新を受け取れない（`next start` で6/6再現。Suspenseを外すと6/6成功）。
 * 既定表示（q/starなし）の本文はDB1クエリのみ＝GitHub呼び出しゼロなので、
 * ブロッキングレンダーでも体感は変わらない
 */
export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; star?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const { q, star } = await searchParams;
  const queryState = queryStateOf(q);
  const showStarred = star === '1';
  const paper = paperDateFor(new Date());

  return (
    <main className={paperStyles.backdrop}>
      <div className={paperStyles.paper}>
        <SubscriptionMasthead paper={paper} />
        <SubscriptionBody
          userId={session.user.id}
          queryState={queryState}
          showStarred={showStarred}
        />
        <footer className={paperStyles.colophon}>
          <nav aria-label="紙面案内">
            <Link href="/">一面へ戻る</Link>
            <span aria-hidden="true">｜</span>
            <Link href="/trending">トレンド面</Link>
            <span aria-hidden="true">｜</span>
            <Link href="/digest">縮刷版（ダイジェスト）</Link>
            <span aria-hidden="true">｜</span>
            <form action={signOutAction}>
              <button type="submit" className={paperStyles.linkButton}>
                退勤（ログアウト）
              </button>
            </form>
          </nav>
          発行　RepoRadar観測所
        </footer>
      </div>
    </main>
  );
}
