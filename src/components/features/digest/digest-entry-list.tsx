import Link from 'next/link';
import styles from '@/components/features/paper/paper.module.css';
import { composeDigestOverview, type DigestEntry } from '@/lib/digest';
import { formatDateJa } from '@/lib/format';

/**
 * 縮刷版の1号ぶんの記事一覧（Issue #41 で紙面語彙に組み替え）。
 * 冒頭の総括（ルールベース）と、リポジトリ詳細へのリンク付きの記事を点線罫で綴じる
 */
export function DigestEntryList({ entries }: { entries: DigestEntry[] }) {
  return (
    <div>
      <p className={styles.fieldNote}>{composeDigestOverview(entries)}</p>
      <ol className={styles.tanshin}>
        {entries.map((entry) => (
          <li key={`${entry.fullName}@${entry.tagName}`}>
            <p className={styles.breakAll}>
              <Link href={`/repos/${entry.owner}/${entry.repo}`}>
                <b>{entry.fullName}</b>
              </Link>
              　{entry.releaseName ?? entry.tagName}
              {entry.hasBreaking && (
                <>
                  　<span className={styles.breaking}>【破壊的変更】</span>
                </>
              )}
            </p>
            <p className={styles.fieldNote}>
              {entry.tagName}　{formatDateJa(entry.publishedAt)}
            </p>
            {entry.headline && (
              <p>
                <b>{entry.headline}</b>
              </p>
            )}
            {entry.summary ? (
              <p className={styles.preLine}>{entry.summary}</p>
            ) : (entry.noteless ?? true) ? (
              // noteless欠落（#36以前のエントリ）は区別できないため従来表示に倒す
              <p className={styles.fieldNote}>リリースノートなし</p>
            ) : (
              // 生成失敗。共有要約プールに行が無いままなので、翌日のバックフィルで自動再試行される
              <p className={styles.fieldNote}>要約を生成できませんでした</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
