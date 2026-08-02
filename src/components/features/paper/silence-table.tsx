import Link from 'next/link';
import type { SilentRow } from '@/lib/paper';
import styles from './paper.module.css';

/** 沈黙の記録: 最終リリース180日超の銘柄を沈黙の長い順に。一年超は太字（tr.dead） */
export function SilenceTable({ rows, rateLimited }: { rows: SilentRow[]; rateLimited: boolean }) {
  return (
    <div>
      <span className={styles.kanban}>沈黙の記録</span>
      {rows.length > 0 ? (
        <table className={styles.chart}>
          <caption>無信号百八十日超。一年超は太字</caption>
          <thead>
            <tr>
              <th scope="col">銘柄</th>
              <th scope="col">最終信号</th>
              <th scope="col" className={styles.num}>
                沈黙
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fullName} className={row.overYear ? styles.dead : undefined}>
                <td>
                  <Link href={row.href}>{row.fullName}</Link>
                </td>
                <td>{row.tagName}</td>
                <td className={styles.num}>{row.spanLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.kyusai}>
          {rateLimited ? '観測休止につき本日の記録なし。' : '観測域に百八十日超の沈黙なし。'}
        </p>
      )}
    </div>
  );
}
