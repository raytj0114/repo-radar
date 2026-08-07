import { describe, expect, it } from 'vitest';
import {
  composeSummaryText,
  parseStructuredReleaseSummary,
  releaseSummaryResponseSchema,
  RELEASE_SUMMARY_PROMPT_VERSION,
  SUMMARY_LINE_COUNT,
} from '@/lib/gemini/structured';

const VALID = {
  headline: 'Turbopack既定化',
  lede: 'ビルドの既定がTurbopackに切り替わった。',
  lines: ['Turbopackが既定に', 'PPRが安定版に', '画像最適化のメモリを削減'],
  hasBreaking: true,
};

describe('composeSummaryText', () => {
  it('各行に「・」を補って改行で連結する', () => {
    expect(composeSummaryText(['a', 'b', 'c'])).toBe('・a\n・b\n・c');
  });

  it('すでに「・」がある行には重ねない', () => {
    expect(composeSummaryText(['・a', 'b'])).toBe('・a\n・b');
  });

  it('空行・空白のみの行は落とす', () => {
    expect(composeSummaryText(['a', '  ', '', ' b '])).toBe('・a\n・b');
  });
});

describe('parseStructuredReleaseSummary', () => {
  it('スキーマ通りのJSONを構造化結果として返す', () => {
    const result = parseStructuredReleaseSummary(JSON.stringify(VALID));
    expect(result).toEqual({ ok: true, value: VALID });
  });

  it('コードフェンスで包まれていても読める', () => {
    const result = parseStructuredReleaseSummary('```json\n' + JSON.stringify(VALID) + '\n```');
    expect(result.ok).toBe(true);
  });

  it('各値の前後の空白は落とす', () => {
    const result = parseStructuredReleaseSummary(
      JSON.stringify({ ...VALID, headline: '  見出し  ', lines: [' a ', 'b', 'c'] })
    );
    expect(result).toEqual({
      ok: true,
      value: { ...VALID, headline: '見出し', lines: ['a', 'b', 'c'] },
    });
  });

  it(`要点が${SUMMARY_LINE_COUNT}行でなければ構造化は失敗し、テキストへ縮退する`, () => {
    const result = parseStructuredReleaseSummary(JSON.stringify({ ...VALID, lines: ['a', 'b'] }));
    expect(result).toEqual({ ok: false, fallbackText: '・a\n・b' });
  });

  it('hasBreakingが欠けていてもlinesが取れればテキストへ縮退する', () => {
    const result = parseStructuredReleaseSummary(
      JSON.stringify({ headline: '見出し', lede: '前文', lines: ['a', 'b', 'c'] })
    );
    expect(result).toEqual({ ok: false, fallbackText: '・a\n・b\n・c' });
  });

  it('JSONとして読めない素のテキストはそのまま縮退テキストにする', () => {
    const result = parseStructuredReleaseSummary('・要約1\n・要約2\n・要約3');
    expect(result).toEqual({ ok: false, fallbackText: '・要約1\n・要約2\n・要約3' });
  });

  it('壊れたJSONは救えないのでリトライ対象にする', () => {
    const result = parseStructuredReleaseSummary('{"headline": "見出し", "lines": [');
    expect(result).toEqual({ ok: false, fallbackText: null });
  });

  it('空文字はリトライ対象にする', () => {
    expect(parseStructuredReleaseSummary('   ')).toEqual({ ok: false, fallbackText: null });
  });

  it('linesが空配列なら保存できるテキストが無いのでリトライ対象にする', () => {
    const result = parseStructuredReleaseSummary(JSON.stringify({ ...VALID, lines: [] }));
    expect(result).toEqual({ ok: false, fallbackText: null });
  });
});

describe('releaseSummaryResponseSchema', () => {
  it('4項目すべてを必須にし、要点の行数をプロンプトと揃える', () => {
    expect(releaseSummaryResponseSchema.required).toEqual([
      'headline',
      'lede',
      'lines',
      'hasBreaking',
    ]);
    expect(releaseSummaryResponseSchema.properties.lines.minItems).toBe(SUMMARY_LINE_COUNT);
    expect(releaseSummaryResponseSchema.properties.lines.maxItems).toBe(SUMMARY_LINE_COUNT);
  });

  it('プロンプト世代は第3版（新聞常体）。世代交代はこのテストの更新を伴う意図的な変更にする', () => {
    expect(RELEASE_SUMMARY_PROMPT_VERSION).toBe(3);
  });
});
