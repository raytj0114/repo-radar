import Link from 'next/link';
import type { BriefLine } from '@/lib/paper';
import styles from './paper.module.css';

/** レート上限の観測休止帯の文言。e2e/rate-limit.spec.ts が同じ文字列を検証する */
export const STOP_PRESS_TEXT = 'レート上限につき観測休止中。回復し次第、自動で紙面に戻る。';

/**
 * 短信欄: 一面・二番手以外の各銘柄の最新信号を1行ずつ。
 * 現ダッシュボードのタイムラインはこの欄（+ 沈黙の記録）に吸収された（Issue #31）
 */
export function BriefList({
  lines,
  hasFavorites,
  rateLimited,
  failedCount,
}: {
  lines: BriefLine[];
  hasFavorites: boolean;
  rateLimited: boolean;
  failedCount: number;
}) {
  return (
    <div>
      <span className={styles.kanban}>短信</span>
      {rateLimited && <p className={styles.stopPress}>{STOP_PRESS_TEXT}</p>}
      {lines.length > 0 ? (
        <ul className={styles.tanshin}>
          {lines.map((line) => (
            <li key={line.fullName}>
              ▽
              <Link href={line.href}>
                <b>{line.repoName}</b>
              </Link>
              　{line.text}（{line.whenLabel}）
            </li>
          ))}
        </ul>
      ) : (
        !rateLimited && (
          <p className={styles.kyusai}>
            {hasFavorites ? (
              '六十日以内の新信号なし。'
            ) : (
              <>
                観測銘柄が未登録。<Link href="/favorites">購読面</Link>から登録を。
              </>
            )}
          </p>
        )
      )}
      {failedCount > 0 && (
        <p className={styles.kyusai}>一部銘柄（{failedCount}件）の観測に失敗。次版で再観測する。</p>
      )}
    </div>
  );
}
