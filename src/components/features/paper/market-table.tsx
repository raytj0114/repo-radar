import Link from 'next/link';
import type { MarketRow } from '@/lib/paper';
import styles from './paper.module.css';

/**
 * 相場欄: トレンド（新興リポジトリ）の星数と日割。
 * 「日割」は作成からの1日平均★で、実データからの導出。前日比は星数の履歴が
 * 存在しないため載せない（捏造しない。基盤づくりは別Issue）
 */
export function MarketTable({
  rows,
  rateLimited,
}: {
  rows: MarketRow[] | null;
  rateLimited: boolean;
}) {
  return (
    <div>
      <span className={styles.kanban}>相場</span>
      {rows && rows.length > 0 ? (
        <table className={styles.chart}>
          <caption>スター相場（新興・観測三十日）「日割」は作成からの一日平均</caption>
          <thead>
            <tr>
              <th scope="col">銘柄</th>
              <th scope="col" className={styles.num}>
                星数
              </th>
              <th scope="col" className={styles.num}>
                日割
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fullName}>
                <td>
                  <Link href={row.href}>{row.fullName}</Link>
                </td>
                <td className={styles.num}>{row.stars.toLocaleString('ja-JP')}</td>
                <td className={`${styles.num} ${styles.up}`}>
                  {row.perDay === null ? '─' : row.perDay.toLocaleString('ja-JP')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.kyusai}>
          {rateLimited ? '検索枠の上限につき本日は休載。' : 'データリンク不通につき休載。'}
        </p>
      )}
    </div>
  );
}
