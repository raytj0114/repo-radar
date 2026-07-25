import { describe, expect, it } from 'vitest';
import { formatCompactNumber, formatDateJa } from '@/lib/format';

describe('formatDateJa', () => {
  it('ISO 8601日時を日本時間の日付にする', () => {
    expect(formatDateJa('2026-07-10T18:30:00Z')).toBe('2026/07/11');
  });

  it('日本時間で日付をまたがない場合はそのままの日付になる', () => {
    expect(formatDateJa('2026-07-10T02:00:00Z')).toBe('2026/07/10');
  });
});

describe('formatCompactNumber', () => {
  it('千の位をK表記にする', () => {
    expect(formatCompactNumber(8421)).toBe('8.4K');
  });

  it('十万以上もコンパクトに丸める', () => {
    expect(formatCompactNumber(128000)).toBe('128K');
  });

  it('千未満はそのまま', () => {
    expect(formatCompactNumber(999)).toBe('999');
  });
});
