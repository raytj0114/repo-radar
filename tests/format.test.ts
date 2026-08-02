import { describe, expect, it } from 'vitest';
import {
  formatCompactNumber,
  formatDateJa,
  formatDateKanjiJa,
  formatSilenceSpanJa,
  toKanjiDigits,
  toKanjiNumber,
} from '@/lib/format';

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

describe('toKanjiDigits', () => {
  it('桁ごとに読み下す（号数・年の表記）', () => {
    expect(toKanjiDigits(414)).toBe('四一四');
    expect(toKanjiDigits(2026)).toBe('二〇二六');
    expect(toKanjiDigits(1)).toBe('一');
    expect(toKanjiDigits(0)).toBe('〇');
  });

  it('負数・非整数は拒否する', () => {
    expect(() => toKanjiDigits(-1)).toThrow(RangeError);
    expect(() => toKanjiDigits(1.5)).toThrow(RangeError);
  });
});

describe('toKanjiNumber', () => {
  it('位取りで読む（日・月・期間の表記）', () => {
    expect(toKanjiNumber(8)).toBe('八');
    expect(toKanjiNumber(10)).toBe('十');
    expect(toKanjiNumber(20)).toBe('二十');
    expect(toKanjiNumber(31)).toBe('三十一');
    expect(toKanjiNumber(99)).toBe('九十九');
  });

  it('100以上は桁読みに倒す', () => {
    expect(toKanjiNumber(414)).toBe('四一四');
  });
});

describe('formatDateKanjiJa', () => {
  it('日本時間の和文日付にする（曜日付き）', () => {
    // 2026-07-31T21:00Z = 2026-08-01 06:00 JST（土曜日）
    expect(formatDateKanjiJa('2026-07-31T21:00:00Z')).toBe('二〇二六年八月一日　土曜日');
  });

  it('JSTで日付をまたがない時刻はそのままの日付になる', () => {
    expect(formatDateKanjiJa('2026-07-31T02:00:00Z')).toBe('二〇二六年七月三十一日　金曜日');
  });
});

describe('formatSilenceSpanJa', () => {
  it('一年未満は箇月のみ', () => {
    expect(formatSilenceSpanJa(200)).toBe('六箇月');
    expect(formatSilenceSpanJa(330)).toBe('十箇月');
  });

  it('一年以上は年+箇月、端数の無い年はそのまま', () => {
    expect(formatSilenceSpanJa(470)).toBe('一年三箇月');
    expect(formatSilenceSpanJa(366)).toBe('一年');
  });
});
