import Link from 'next/link';
import { SubscribeToggle } from '@/components/features/favorites/subscribe-toggle';
import { deltaViewOf } from '@/components/features/paper/market-table';
import styles from '@/components/features/paper/paper.module.css';
import type { SearchRepositoriesResult } from '@/lib/github/schemas';
import type { MarketDelta } from '@/lib/paper';

type SearchItem = SearchRepositoriesResult['items'][number];

export type TrendRow = {
  rank: number;
  item: SearchItem;
  /** 増減は一面の相場欄と同じ三態（実差分 / 日割 / ─）。捏造しない */
  delta: MarketDelta;
  subscribed: boolean;
};

/**
 * トレンド面の全表（Issue #41）: 一面の相場欄（上位6銘柄）の続き面。
 * 列の意味・増減の組み方（deltaViewOf）・縮退の三態を相場欄と共有する
 */
export function TrendTable({ rows }: { rows: TrendRow[] }) {
  return (
    <table className={styles.chart}>
      <caption>
        スター相場の全表（新興・観測三十日）前日比は朝六時の観測差、※は欠測を挟む直近観測比、日割は作成からの一日平均
      </caption>
      <thead>
        <tr>
          <th scope="col" className={styles.num}>
            順位
          </th>
          <th scope="col">銘柄</th>
          <th scope="col" className={styles.num}>
            星数
          </th>
          <th scope="col" className={styles.num}>
            前日比
          </th>
          <th scope="col">手続</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const delta = deltaViewOf(row.delta);
          return (
            <tr key={row.item.id}>
              <td className={styles.num}>{row.rank}</td>
              <td className={styles.breakAll}>
                <Link href={`/repos/${row.item.owner.login}/${row.item.name}`}>
                  {row.item.full_name}
                </Link>
                {(row.item.language || row.item.description) && (
                  <small className={styles.repoDesc}>
                    {row.item.language && `〔${row.item.language}〕`}
                    {row.item.description}
                  </small>
                )}
              </td>
              <td className={styles.num}>{row.item.stargazers_count.toLocaleString('ja-JP')}</td>
              <td
                className={[styles.num, delta.up ? styles.up : null].filter(Boolean).join(' ')}
                aria-label={delta.label}
              >
                {delta.text}
              </td>
              <td>
                <SubscribeToggle
                  owner={row.item.owner.login}
                  name={row.item.name}
                  avatarUrl={row.item.owner.avatar_url}
                  isSubscribed={row.subscribed}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
