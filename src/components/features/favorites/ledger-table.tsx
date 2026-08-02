import Link from 'next/link';
import { formatDateJa, toKanjiNumber } from '@/lib/format';
import paperStyles from '@/components/features/paper/paper.module.css';
import styles from './favorites.module.css';
import { SubscribeToggle } from './subscribe-toggle';

export type LedgerRow = {
  owner: string;
  name: string;
  fullName: string;
  avatarUrl: string | null;
  createdAt: Date;
};

/** 購読台帳: 現在の観測域の一覧と解約。紙面（一面・短信・沈黙）が観測する銘柄そのもの */
export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <div>
      <span className={paperStyles.kanban}>購読台帳</span>
      {rows.length > 0 ? (
        <table className={paperStyles.chart}>
          <caption>
            購読中　{toKanjiNumber(rows.length)}銘柄　—　紙面の観測域はこの台帳で決まる
          </caption>
          <thead>
            <tr>
              <th scope="col">銘柄</th>
              <th scope="col" className={paperStyles.num}>
                登録日
              </th>
              <th scope="col">手続</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fullName}>
                <td className={styles.breakAll}>
                  <Link href={`/repos/${row.owner}/${row.name}`}>{row.fullName}</Link>
                </td>
                <td className={paperStyles.num}>{formatDateJa(row.createdAt.toISOString())}</td>
                <td>
                  <SubscribeToggle
                    owner={row.owner}
                    name={row.name}
                    avatarUrl={row.avatarUrl}
                    isSubscribed
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={paperStyles.kyusai}>
          購読銘柄なし。下の銘柄検索または星取帳から登録すると、翌朝から紙面が組まれる。
        </p>
      )}
    </div>
  );
}
