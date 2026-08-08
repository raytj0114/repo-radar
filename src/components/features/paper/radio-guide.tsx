import Link from 'next/link';
import { RADIO_PROGRAM_GUIDE, RADIO_STATION_META, type RadioStationId } from '@/lib/radio';
import styles from './paper.module.css';

/** ラテ欄に載せる局の順（周波数の低い順 = ダイヤル盤の並び） */
const GUIDE_ORDER: readonly RadioStationId[] = ['r1', 'wx', 'nb'];

/**
 * ラテ欄（Issue #41）: 紙面の「JORR 本日の放送」欄。/radio への導線を世界観の内側に置く
 * （奥付の暫定リンクからの移設）。データは局のメタと編集文言（純関数モジュール）のみで、
 * 取得ゼロ＝一面のシェルの一部として即時送出できる（ストリーミング契約を壊さない）
 */
export function RadioGuide() {
  return (
    <div>
      <span className={styles.kanban}>ラテ欄</span>
      <table className={styles.chart}>
        <caption>JORR 本日の放送</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.num}>
              周波数
            </th>
            <th scope="col">局名</th>
            <th scope="col">番組</th>
          </tr>
        </thead>
        <tbody>
          {GUIDE_ORDER.map((id) => {
            const station = RADIO_STATION_META[id];
            const guide = RADIO_PROGRAM_GUIDE[id];
            return (
              <tr key={id}>
                <td className={styles.num}>{station.freq.toFixed(1)}</td>
                <td>{station.name}</td>
                <td>
                  {guide.time}　{guide.program}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.nextNote}>
        <Link href="/radio">（受信機を合わせる → 深夜放送）</Link>
      </p>
    </div>
  );
}
