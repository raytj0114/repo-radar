import { weatherFor } from '@/lib/paper';
import type { RateLimitSnapshot } from '@/lib/github/schemas';
import styles from './paper.module.css';

/** 天気欄（API残量）。snapshot が null（観測失敗）なら休載表示に縮退する */
export function WeatherBox({ snapshot }: { snapshot: RateLimitSnapshot | null }) {
  const weather = snapshot ? weatherFor(snapshot) : null;
  return (
    <div className={styles.weather}>
      <div className={styles.weatherTitle}>本日のAPI残量</div>
      <div className={styles.sky}>{weather?.sky ?? '休'}</div>
      <div className={styles.weatherNum}>
        {snapshot
          ? `${snapshot.remaining.toLocaleString('ja-JP')} ／ ${snapshot.limit.toLocaleString('ja-JP')}`
          : '─ ／ ─'}
      </div>
      <div className={styles.weatherMemo}>{weather?.memo ?? 'データリンク不通につき休載。'}</div>
    </div>
  );
}
