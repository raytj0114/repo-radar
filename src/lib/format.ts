// 表示用フォーマッタ（純粋関数。変更時は tests/format.test.ts も更新）

/** ISO 8601日時を日本時間の日付表記にする（例: 2026/07/10） */
export function formatDateJa(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(iso));
}

/** スター数などを短縮表記にする（例: 8421 → 8.4K） */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
