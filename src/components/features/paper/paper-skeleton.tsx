import styles from './paper.module.css';

/**
 * 紙面本文のSuspenseフォールバック。
 * aria-busy は e2e/fixtures.ts の expectNoHorizontalOverflow が「全スケルトンの消滅」を
 * 待つための契約（外すと375px検証がストリーミング完了前に測ってすり抜ける）。
 * aria-label はストリーミング検証（authed.spec.ts）がバイト順の目印にする
 */
export function PaperBodySkeleton() {
  return (
    <section
      className={`${styles.section} ${styles.noRule}`}
      role="status"
      aria-busy="true"
      aria-label="組版中"
    >
      <p className={styles.kyusai}>（組版中）</p>
    </section>
  );
}
