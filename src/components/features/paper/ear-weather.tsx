import { fetchRateLimit } from '@/lib/github/client';
import { weatherFor } from '@/lib/paper';

/**
 * 左耳のAPI残量（ミニ天気）。/rate_limit はレート枠を消費せず、60秒キャッシュされる。
 * 下段の天気欄と同一URLのfetchなので、1リクエスト内では重複排除される
 */
export async function EarWeather() {
  let line = '休載';
  try {
    const snapshot = await fetchRateLimit();
    line = `${weatherFor(snapshot).sky}　${snapshot.remaining.toLocaleString('ja-JP')}`;
  } catch {
    // 観測不能でも耳は残す（紙面の枠組みを崩さない）
  }
  return (
    <>
      本日のAPI残量
      <br />
      {line}
    </>
  );
}
