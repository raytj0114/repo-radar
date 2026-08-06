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
 * Suspense境界があるとaction応答がクライアントへ届かず、サーバー側は書き込み済みなのに
 * UIだけが `useTransition` のpendingで固まる（Next 16.2.10）。
 *
 * Issue #47 で同一ビルドに対し 画面の形状 × 輸送層 を各20試行（計240試行）実測した。
 * この面については:
 * - Suspenseで包まない版: **60/60成功**（HTTP/1.1・TLS+HTTP/1.1・HTTP/2 のいずれでも）
 * - 包んだ版: HTTP/1.1 **4/20**、TLS+HTTP/1.1 **5/20**、HTTP/2 **19/20**
 * 輸送層は強い修飾要因だが**HTTP/2でも消えない**ので、戻す理由がない。
 * 表と他画面の結果、判断の根拠は `docs/ARCHITECTURE.md` の「レンダリング制約」を見ること
 *
 * 既定表示（q/starなし）の本文はDB1クエリのみ＝GitHub呼び出しゼロなので、
 * ブロッキングレンダーでも体感は変わらない（`?star=1` で重くしても 60/60 通ることは実測済み）
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
