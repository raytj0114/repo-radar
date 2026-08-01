import { z } from 'zod';
import type { GenerationValidation } from '@/lib/gemini/client';

// リリース要約の構造化出力（見出し・前文・3行・破壊的変更フラグ）の契約とパース。
// 純粋関数のみ。Gemini呼び出し回数を増やさずに構造を得るため、
// 検証失敗時は client.ts の既存リトライ枠の内側で再試行され、最後はテキストのみへ縮退する。

/** プロンプト世代。1 = 構造化以前のプレーンテキスト3行 / 2 = 構造化JSON */
export const RELEASE_SUMMARY_PROMPT_VERSION = 2;

/** 要点の行数。プロンプト・responseSchema・Zod検証で同じ値を使う */
export const SUMMARY_LINE_COUNT = 3;

const BULLET = '・';

/**
 * Gemini の generationConfig.responseSchema（REST v1beta の Schema 型は大文字表記）。
 * モデル側にも構造を強制し、パース失敗による縮退を減らす。
 */
export const releaseSummaryResponseSchema = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    lede: { type: 'STRING' },
    lines: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      minItems: SUMMARY_LINE_COUNT,
      maxItems: SUMMARY_LINE_COUNT,
    },
    hasBreaking: { type: 'BOOLEAN' },
  },
  required: ['headline', 'lede', 'lines', 'hasBreaking'],
  propertyOrdering: ['headline', 'lede', 'lines', 'hasBreaking'],
} as const;

export const structuredReleaseSummarySchema = z.object({
  headline: z.string().trim().min(1).max(80),
  lede: z.string().trim().min(1).max(400),
  lines: z.array(z.string().trim().min(1)).length(SUMMARY_LINE_COUNT),
  hasBreaking: z.boolean(),
});

export type StructuredReleaseSummary = z.infer<typeof structuredReleaseSummarySchema>;

/** 3行の要点を既存の表示（`summary` 列）と同じ「・」付きテキストへ組み立てる */
export function composeSummaryText(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => (line.startsWith(BULLET) ? line : `${BULLET}${line}`))
    .join('\n');
}

const codeFencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = codeFencePattern.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function looksLikeJson(text: string): boolean {
  return text.startsWith('{') || text.startsWith('[');
}

/** 構造は満たさないが要点だけは取れる出力から、テキストとして救える部分を拾う */
const salvageableLinesSchema = z.object({ lines: z.array(z.string()) });

/**
 * モデル出力を構造化要約として検証する。
 * 失敗しても要約テキストとして保存できる形が残っていれば `fallbackText` に載せ、
 * それも無ければ `null`（＝リトライ対象。全滅すれば要約自体を諦める）。
 */
export function parseStructuredReleaseSummary(
  raw: string
): GenerationValidation<StructuredReleaseSummary> {
  const text = stripCodeFence(raw);
  if (text === '') return { ok: false, fallbackText: null };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // JSONとして読めない出力。素のテキストなら要約としては使える
    return { ok: false, fallbackText: looksLikeJson(text) ? null : text };
  }

  const structured = structuredReleaseSummarySchema.safeParse(json);
  if (structured.success) return { ok: true, value: structured.data };

  const salvageable = salvageableLinesSchema.safeParse(json);
  const fallbackText = salvageable.success ? composeSummaryText(salvageable.data.lines) : '';
  return { ok: false, fallbackText: fallbackText === '' ? null : fallbackText };
}
