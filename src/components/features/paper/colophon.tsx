import Link from 'next/link';
import { signOutAction } from '@/app/actions/auth';
import { toKanjiDigits } from '@/lib/format';
import styles from './paper.module.css';

/**
 * 奥付。グローバルヘッダーを持たない紙面のナビ・ログアウトの受け皿
 * （題字脇の耳ナビと対。2026-08-02のユーザー裁定）
 */
export function Colophon({
  userName,
  issueNumber,
}: {
  userName: string | null | undefined;
  issueNumber: number;
}) {
  return (
    <footer className={styles.colophon}>
      <nav aria-label="紙面案内">
        <Link href="/trending">トレンド面</Link>
        <span aria-hidden="true">｜</span>
        <Link href="/digest">縮刷版（ダイジェスト）</Link>
        <span aria-hidden="true">｜</span>
        {/* 購読面への暫定導線。Issue #41 のナビ規約適用時に置き場を整理する */}
        <Link href="/favorites">購読面</Link>
        <span aria-hidden="true">｜</span>
        {/* 深夜放送への暫定導線。Issue #41 で紙面に「ラテ欄」を組み、そちらへ移す */}
        <Link href="/radio">深夜放送</Link>
        <span aria-hidden="true">｜</span>
        <form action={signOutAction}>
          <button type="submit" className={styles.linkButton}>
            退勤（ログアウト）
          </button>
        </form>
      </nav>
      発行　RepoRadar観測所｜観測者　{userName ?? '匿名'}｜第{toKanjiDigits(issueNumber)}号
    </footer>
  );
}
