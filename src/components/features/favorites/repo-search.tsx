import Link from 'next/link';
import type { SearchRepositoriesResult } from '@/lib/github/schemas';
import { paperRepoKey } from '@/lib/paper';
import paperStyles from '@/components/features/paper/paper.module.css';
import styles from './favorites.module.css';
import { SubscribeToggle } from './subscribe-toggle';

/**
 * 検索欄の状態。送信式（逐次検索しない）: searchプールは30/min・フロア3と小さく、
 * 打鍵ごとの検索は一人で枠を食い潰すため（Issue #42）
 */
export type SearchState =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'rate-limited' }
  | { kind: 'failed' }
  | { kind: 'ok'; result: SearchRepositoriesResult };

/** 銘柄検索: GitHub名前検索（送信式）。結果の行から直接購読できる */
export function RepoSearch({
  state,
  defaultTerm,
  keepStarOpen,
  subscribedKeys,
}: {
  state: SearchState;
  defaultTerm: string;
  /** 星取帳を開いたまま検索したとき、`star=1` をhiddenで維持して欄が閉じないようにする */
  keepStarOpen: boolean;
  /** paperRepoKey（小文字）の集合 */
  subscribedKeys: ReadonlySet<string>;
}) {
  return (
    <div>
      <span className={paperStyles.kanban}>銘柄検索</span>
      <form action="/favorites" method="get" className={styles.searchForm}>
        {keepStarOpen && <input type="hidden" name="star" value="1" />}
        <input
          type="text"
          name="q"
          defaultValue={defaultTerm}
          aria-label="検索語"
          className={styles.field}
          placeholder="例: next.js"
        />
        <button type="submit" className={styles.stamp}>
          検索
        </button>
        <p className={styles.fieldNote}>銘柄名で引く。使える字は英数字・空白・「. - _」のみ。</p>
      </form>
      <SearchOutcome state={state} subscribedKeys={subscribedKeys} />
    </div>
  );
}

function SearchOutcome({
  state,
  subscribedKeys,
}: {
  state: SearchState;
  subscribedKeys: ReadonlySet<string>;
}) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'invalid':
      return (
        <p className={paperStyles.kyusai}>
          検索語に使えない字が含まれる。英数字・空白・「. - _」のみで引き直しを。
        </p>
      );
    case 'rate-limited':
      // 相場欄（market-table.tsx）と同文。検索は相場と同じsearchプールを使う
      return <p className={paperStyles.kyusai}>検索枠の上限につき本日は休載。</p>;
    case 'failed':
      return <p className={paperStyles.kyusai}>データリンク不通につき休載。</p>;
    case 'ok':
      return state.result.items.length === 0 ? (
        <p className={paperStyles.kyusai}>該当銘柄なし。</p>
      ) : (
        <table className={paperStyles.chart}>
          <caption>検索の結果（上位十件まで）</caption>
          <thead>
            <tr>
              <th scope="col">銘柄</th>
              <th scope="col" className={paperStyles.num}>
                星数
              </th>
              <th scope="col">手続</th>
            </tr>
          </thead>
          <tbody>
            {state.result.items.map((repo) => (
              <tr key={repo.id}>
                <td className={styles.breakAll}>
                  <Link href={`/repos/${repo.owner.login}/${repo.name}`}>{repo.full_name}</Link>
                  {repo.description && (
                    <small className={styles.repoDesc}>{repo.description}</small>
                  )}
                </td>
                <td className={paperStyles.num}>{repo.stargazers_count.toLocaleString('ja-JP')}</td>
                <td>
                  <SubscribeToggle
                    owner={repo.owner.login}
                    name={repo.name}
                    avatarUrl={repo.owner.avatar_url}
                    isSubscribed={subscribedKeys.has(paperRepoKey(repo.owner.login, repo.name))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
