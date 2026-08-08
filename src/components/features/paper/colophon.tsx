import { Fragment } from 'react';
import Link from 'next/link';
import { signOutAction } from '@/app/actions/auth';
import { toKanjiDigits } from '@/lib/format';
import styles from './paper.module.css';

/** 奥付ナビに載る面。現在の面はリンクにせず素の文字で示す */
export type PaperFace = 'front' | 'trending' | 'digest' | 'favorites';

const NAV_ITEMS: ReadonlyArray<{ face: PaperFace; href: string; label: string }> = [
  { face: 'front', href: '/', label: '一面' },
  { face: 'trending', href: '/trending', label: 'トレンド面' },
  { face: 'digest', href: '/digest', label: '縮刷版（ダイジェスト）' },
  { face: 'favorites', href: '/favorites', label: '購読面' },
];

/**
 * 奥付。グローバルヘッダーを持たない紙面のナビ・ログアウトの受け皿
 * （題字脇の耳ナビ／内面の扉と対。ナビ規約は 2026-08-02のユーザー裁定 + Issue #41）
 */
export function Colophon({
  userName,
  issueNumber,
  current,
}: {
  userName: string | null | undefined;
  issueNumber: number;
  /** この奥付が載っている面。ナビでは行き先にせず現在地として示す */
  current: PaperFace;
}) {
  return (
    <footer className={styles.colophon}>
      <nav aria-label="紙面案内">
        {NAV_ITEMS.map((item) => (
          <Fragment key={item.face}>
            {item.face === current ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <Link href={item.href}>{item.label}</Link>
            )}
            <span aria-hidden="true">｜</span>
          </Fragment>
        ))}
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
