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

// ---- 紙面（Issue #31）用の和文数字 ----

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 桁ごとの読み下し（号数・年に使う）。例: 414 → 四一四、2026 → 二〇二六 */
export function toKanjiDigits(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`toKanjiDigits: 非負整数のみ対応: ${value}`);
  }
  return [...String(value)].map((digit) => KANJI_DIGITS[Number(digit)]).join('');
}

/**
 * 位取りの漢数字（日・月・期間に使う）。例: 31 → 三十一、10 → 十、8 → 八。
 * 紙面で使う範囲（1〜99）のみ対応し、範囲外は桁読みに倒す
 */
export function toKanjiNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`toKanjiNumber: 非負整数のみ対応: ${value}`);
  }
  if (value >= 100) return toKanjiDigits(value);
  if (value < 10) return KANJI_DIGITS[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${tens > 1 ? KANJI_DIGITS[tens] : ''}十${ones ? KANJI_DIGITS[ones] : ''}`;
}

/** ISO 8601日時を日本時間の和文日付にする（例: 二〇二六年八月二日　日曜日） */
export function formatDateKanjiJa(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const year = toKanjiDigits(Number(part('year')));
  const month = toKanjiNumber(Number(part('month')));
  const day = toKanjiNumber(Number(part('day')));
  return `${year}年${month}月${day}日　${part('weekday')}`;
}

/**
 * 沈黙期間の和文表記（例: 十箇月、一年三箇月）。月数は平均月長30.44日で丸める。
 * 沈黙の記録（180日超）に使うため、6箇月未満は想定しない
 */
export function formatSilenceSpanJa(days: number): string {
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${toKanjiNumber(months)}箇月`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${toKanjiNumber(years)}年${rest ? `${toKanjiNumber(rest)}箇月` : ''}`;
}
