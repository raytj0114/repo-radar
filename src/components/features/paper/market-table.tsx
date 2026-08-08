import Link from 'next/link';
import type { MarketDelta, MarketRow } from '@/lib/paper';
import styles from './paper.module.css';

/** 増減欄のセルの見え方。`label` は読み上げ環境向けの言い換え（▲▼は記号のままでは伝わらない） */
export type DeltaView = { text: string; label: string; up: boolean };

/**
 * 増減欄の組み方（Issue #40）。数字の出所は星数スナップショットの実差分だけで、
 * 差分が作れない銘柄には前日比風の数字を出さない（日割・「─」へ縮退する）。
 * 色は紙面の三色（紙・墨・朱）を崩さないため上昇のみ朱にし、増減の別は ▲▼ 記号が担う。
 * トレンド面（相場の全表）と共用する（Issue #41）
 */
export function deltaViewOf(delta: MarketDelta): DeltaView {
  if (delta.kind === 'none') return { text: '─', label: '記録なし', up: false };
  if (delta.kind === 'perDay') {
    const perDay = delta.perDay.toLocaleString('ja-JP');
    return { text: `日割 ${perDay}`, label: `日割 ${perDay}`, up: false };
  }

  // ※ = 欠測日を挟むため前日比ではなく直近観測との差（caption で断っている）
  const kind = delta.previousDay ? '前日比' : '直近観測比';
  const mark = delta.previousDay ? '' : '※';
  if (delta.delta === 0) return { text: `±0${mark}`, label: `${kind} 変わらず`, up: false };

  const amount = Math.abs(delta.delta).toLocaleString('ja-JP');
  const up = delta.delta > 0;
  return {
    text: `${up ? '▲' : '▼'}${amount}${mark}`,
    label: `${kind} ${amount}${up ? '増' : '減'}`,
    up,
  };
}

/**
 * 相場欄: トレンド（新興リポジトリ）の星数と前日比。
 * 前日比は朝6時（21:00 UTC）に採った星数スナップショットの実差分で、
 * 欠測日を挟む銘柄は「※」付きの直近観測比、観測が1件以下の銘柄は日割へ縮退する
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
        <>
          <table className={styles.chart}>
            <caption>
              スター相場（新興・観測三十日）前日比は朝六時の観測差、※は欠測を挟む直近観測比、日割は作成からの一日平均
            </caption>
            <thead>
              <tr>
                <th scope="col">銘柄</th>
                <th scope="col" className={styles.num}>
                  星数
                </th>
                <th scope="col" className={styles.num}>
                  前日比
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const delta = deltaViewOf(row.delta);
                return (
                  <tr key={row.fullName}>
                    <td>
                      <Link href={row.href}>{row.fullName}</Link>
                    </td>
                    <td className={styles.num}>{row.stars.toLocaleString('ja-JP')}</td>
                    <td
                      className={[styles.num, delta.up ? styles.up : null]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={delta.label}
                    >
                      {delta.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.nextNote}>
            <Link href="/trending">（全表はトレンド面に）</Link>
          </p>
        </>
      ) : (
        <p className={styles.kyusai}>
          {rateLimited ? '検索枠の上限につき本日は休載。' : 'データリンク不通につき休載。'}
        </p>
      )}
    </div>
  );
}
