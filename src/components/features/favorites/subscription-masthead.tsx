import Link from 'next/link';
import { formatDateKanjiJa, toKanjiDigits } from '@/lib/format';
import type { PaperDate } from '@/lib/paper';
import paperStyles from '@/components/features/paper/paper.module.css';
import styles from './favorites.module.css';

/**
 * 購読面の題字帯。一面の題字（Masthead）より一回り控えめな「内面の扉」として組む。
 * 同期データのみで組めるため、面のシェルとして即時送出される
 */
export function SubscriptionMasthead({ paper }: { paper: PaperDate }) {
  return (
    <header>
      <p className={styles.wordmark}>
        <Link href="/">日刊 RepoRadar</Link>
      </p>
      <h1 className={styles.menTitle}>購読面</h1>
      <div className={paperStyles.dateline}>
        <span>第{toKanjiDigits(paper.issueNumber)}号</span>
        <span>{formatDateKanjiJa(paper.issuedAtIso)}</span>
        <span>購読の受付</span>
      </div>
    </header>
  );
}
