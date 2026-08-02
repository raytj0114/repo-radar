import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatDateKanjiJa, toKanjiDigits } from '@/lib/format';
import type { PaperDate } from '@/lib/paper';
import styles from './paper.module.css';

/**
 * 題字・耳・日付行。同期データのみで組めるため、紙面のシェルとして即時送出される
 * （左耳のAPI残量だけはpage側がSuspenseで差し込む）。
 * bannerロールがグローバルヘッダーのセレクタと衝突しないよう、<main> の内側で使うこと
 */
export function Masthead({ paper, weatherEar }: { paper: PaperDate; weatherEar: ReactNode }) {
  return (
    <header>
      <div className={styles.masthead}>
        <div className={styles.ear}>{weatherEar}</div>
        <div>
          <h1 className={styles.daiji}>日刊 RepoRadar</h1>
          <p className={styles.motto}>— リリースは不変、紙面は日々 —</p>
        </div>
        <div className={styles.earRight}>
          <nav aria-label="紙面の耳" className={styles.earNav}>
            <Link href="/trending">トレンド面</Link>
            <Link href="/digest">縮刷版</Link>
          </nav>
          <span className={styles.seal} aria-hidden="true">
            観
            <br />測
          </span>
        </div>
      </div>
      <div className={styles.dateline}>
        <span>第{toKanjiDigits(paper.issueNumber)}号</span>
        <span>{formatDateKanjiJa(paper.issuedAtIso)}</span>
        <span>朝刊（六時締）</span>
        <span>観測所発行・無代</span>
      </div>
    </header>
  );
}
