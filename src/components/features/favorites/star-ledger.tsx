import Link from 'next/link';
import { toKanjiNumber } from '@/lib/format';
import { STOP_PRESS_TEXT } from '@/components/features/paper/brief-list';
import paperStyles from '@/components/features/paper/paper.module.css';
import styles from './favorites.module.css';
import { StarImportForm, type StarRow } from './star-import-form';

/**
 * 星取帳の状態。`?star=1` のときだけGitHubへ取りに行き（closed以外）、
 * 既定表示（closed）はAPI呼び出しゼロで扉だけを出す（Issue #42）
 */
export type StarLedgerState =
  | { kind: 'closed'; openHref: string }
  | { kind: 'rate-limited' }
  | { kind: 'failed' }
  | { kind: 'no-account' }
  | { kind: 'login-missing' }
  | { kind: 'ok'; rows: StarRow[] };

/**
 * 星取帳: GitHubで星を付けた銘柄からの選択式取り込み。
 * 自動同期はしない（星は「購読」でなく「しおり」の意味で押されることが多い。設計判断は
 * docs/ARCHITECTURE.md の購読面の節）
 */
export function StarLedger({ state }: { state: StarLedgerState }) {
  return (
    <div>
      <span className={paperStyles.kanban}>星取帳</span>
      <StarLedgerBody state={state} />
    </div>
  );
}

function StarLedgerBody({ state }: { state: StarLedgerState }) {
  switch (state.kind) {
    case 'closed':
      return (
        <p className={styles.teaser}>
          <Link href={state.openHref}>星取帳を繰る</Link>
          <small className={styles.repoDesc}>
            GitHubで星を付けた銘柄から選んで取り込む。自動では同期しない。
          </small>
        </p>
      );
    case 'rate-limited':
      // 短信欄（brief-list.tsx）と同文・同じ朱帯。スター取得は短信と同じcoreプールを使う
      return <p className={paperStyles.stopPress}>{STOP_PRESS_TEXT}</p>;
    case 'failed':
      return <p className={paperStyles.kyusai}>データリンク不通につき休載。</p>;
    case 'no-account':
      return (
        <p className={paperStyles.kyusai}>
          GitHub口座の紐付きが見当たらず、星取帳は開けない。再ログインで復旧の見込み。
        </p>
      );
    case 'login-missing':
      return <p className={paperStyles.kyusai}>GitHub上の口座を確認できず、星取帳は休載。</p>;
    case 'ok': {
      if (state.rows.length === 0) {
        return (
          <p className={paperStyles.kyusai}>
            星付の銘柄なし。GitHubで星を付けると、ここから取り込める。
          </p>
        );
      }
      const subscribedCount = state.rows.filter((row) => row.subscribed).length;
      return (
        <>
          <p className={styles.fieldNote}>
            星取　{toKanjiNumber(state.rows.length)}銘柄
            {subscribedCount > 0 && <>（うち購読中{toKanjiNumber(subscribedCount)}）</>}
            　—　新しい星から三百件まで
          </p>
          <StarImportForm rows={state.rows} />
        </>
      );
    }
  }
}
