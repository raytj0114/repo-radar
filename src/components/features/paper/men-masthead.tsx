import Link from 'next/link';
import { formatDateKanjiJa, toKanjiDigits } from '@/lib/format';
import type { PaperDate } from '@/lib/paper';
import styles from './paper.module.css';

/**
 * 内面の扉（面の題字帯）。一面の題字（Masthead）より一回り控えめに組み、
 * 題字（wordmark）が一面への帰り道を兼ねる（ナビ規約: 上=一面への導線、下=奥付。Issue #41）。
 * 同期データのみで組めるため、面のシェルとして即時送出される
 */
export function MenMasthead({
  paper,
  title,
  edition,
}: {
  paper: PaperDate;
  /** 面の名前（「購読面」「トレンド面」など）。h1になる */
  title: string;
  /** 日付行の右端に添える面の性格（「購読の受付」「相場の全表」など） */
  edition: string;
}) {
  return (
    <header>
      <p className={styles.wordmark}>
        <Link href="/">日刊 RepoRadar</Link>
      </p>
      <h1 className={styles.menTitle}>{title}</h1>
      <div className={styles.dateline}>
        <span>第{toKanjiDigits(paper.issueNumber)}号</span>
        <span>{formatDateKanjiJa(paper.issuedAtIso)}</span>
        <span>{edition}</span>
      </div>
    </header>
  );
}
