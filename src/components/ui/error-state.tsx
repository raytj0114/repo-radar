'use client';

import styles from '@/components/features/paper/paper.module.css';

/**
 * error.tsx（エラー境界）の共通UI。(main)/error.tsx の薄いラッパーから使う。
 * 全画面が紙面意匠になった（Issue #41）ため境界は1枚で、この面も紙面の語彙で組む。
 * /radio（木目意匠の意図的例外）のエラーもここに落ちるが、「受信機が壊れたら
 * 紙の詫び状が届く」として世界観の内側に収める
 */
export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={styles.backdrop}>
      <div className={`${styles.paper} ${styles.paperNarrow}`}>
        <span className={styles.kanban}>落丁</span>
        <div className={`${styles.section} ${styles.noRule} ${styles.article}`}>
          <p>
            紙面に乱丁がありました。データの取得に失敗しています。刷り直しても直らない場合は、時間をおいてもう一度。
          </p>
          {error.digest && <p className={styles.fieldNote}>整理番号　{error.digest}</p>}
        </div>
        <div className={styles.section}>
          <button type="button" onClick={reset} className={styles.stamp}>
            刷り直す
          </button>
        </div>
      </div>
    </main>
  );
}
