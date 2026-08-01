import { z } from 'zod';
import { env } from '@/lib/env';

// Gemini APIクライアント（規約は .claude/skills/ai-cost-guard/SKILL.md）。
// 呼び出し側は必ずDBキャッシュ層（ReleaseSummary / DailyDigest）を経由すること。

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// プライマリが失敗し続けたらフォールバックモデルへ切り替える
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;
const MAX_ATTEMPTS_PER_MODEL = 2;
const RETRY_BASE_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 30_000;

export class GeminiAPIError extends Error {
  constructor(
    readonly status: number,
    safeMessage: string
  ) {
    super(safeMessage);
    this.name = 'GeminiAPIError';
  }
}

const envelopeSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })),
        }),
      })
    )
    .min(1),
});

const BASE_GENERATION_CONFIG = {
  temperature: 0.2,
  maxOutputTokens: 1024,
  thinkingConfig: { thinkingBudget: 0 },
} as const;

/**
 * 生成テキストの検証結果。
 * 失敗しても保存に値するテキストが残っていれば `fallbackText` に載せる
 * （全試行を使い切ったあとの縮退保存に使う）。
 */
export type GenerationValidation<T> =
  { ok: true; value: T } | { ok: false; fallbackText: string | null };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 生成の共通ループ。429/5xx/ネットワークエラー・空応答・検証失敗はモデルごとに最大2回試行し、
 * プライマリで失敗し続けたらフォールバックモデルで再試行する（上限は2モデル×2試行）。
 * 検証失敗でも試行枠は増やさない ＝ 1コンテンツあたりの呼び出し回数は構造化前後で変わらない。
 * 上流のエラー本文はUIへ透過しない（サーバーログのみ）。
 */
async function generate<T>(
  prompt: string,
  generationConfig: Record<string, unknown>,
  validate: (text: string) => GenerationValidation<T>
): Promise<{ value: T | null; text: string; model: string }> {
  let lastStatus = 0;
  /** 検証は通らなかったが保存はできる出力（最後に得られたもの） */
  let degraded: { text: string; model: string } | null = null;

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GOOGLE_GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: 'no-store',
        });
      } catch (error) {
        console.error(`[gemini] ${model} attempt=${attempt} network error:`, error);
        lastStatus = 0;
        await delay(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      if (res.ok) {
        const parsed = envelopeSchema.safeParse(await res.json().catch(() => null));
        const text = parsed.success
          ? parsed.data.candidates[0].content.parts
              .map((part) => part.text ?? '')
              .join('')
              .trim()
          : '';
        if (text !== '') {
          const validated = validate(text);
          if (validated.ok) {
            return { value: validated.value, text, model };
          }
          // 出力の形式が要求と違う。残りの試行枠で作り直し、全滅したら縮退保存へ回す
          console.error(`[gemini] ${model} attempt=${attempt}: response validation failed`);
          // 空の縮退テキストは保存に値しない（TTL無しのキャッシュに空の要約を残さない）
          const fallbackText = validated.fallbackText?.trim() ?? '';
          if (fallbackText !== '') {
            degraded = { text: fallbackText, model };
          }
        } else {
          // 空応答・想定外の形式はリトライ対象
          console.error(`[gemini] ${model} attempt=${attempt}: empty or unexpected response`);
        }
        lastStatus = 502;
        await delay(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      const body = await res.text().catch(() => '');
      console.error(
        `[gemini] ${model} attempt=${attempt} failed: status=${res.status} body=${body.slice(0, 300)}`
      );
      lastStatus = res.status;
      if (res.status === 429 || res.status >= 500) {
        await delay(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      // その他の4xx（キー不正・リクエスト不正）は同一モデルで繰り返しても無意味 → 次のモデルへ
      break;
    }
  }

  // 構造は諦めるが、要約テキストとして使える出力が残っていればそれを返す（縮退）
  if (degraded) {
    console.error('[gemini] falling back to unstructured text');
    return { value: null, text: degraded.text, model: degraded.model };
  }

  throw new GeminiAPIError(
    lastStatus || 502,
    lastStatus === 429 ? 'しばらく時間をおいて再試行してください' : '要約の生成に失敗しました'
  );
}

/** テキスト生成。出力の検証は行わず、非空のテキストが得られた時点で返す。 */
export async function generateText(prompt: string): Promise<{ text: string; model: string }> {
  const { text, model } = await generate(prompt, BASE_GENERATION_CONFIG, (value) => ({
    ok: true,
    value,
  }));
  return { text, model };
}

/**
 * 構造化生成（JSONモード）。`validate` が通らなければ既存のリトライ枠の内側で作り直し、
 * 全滅した場合のみ `data: null` ＋ 縮退テキストを返す（呼び出し側でテキストのみ保存する）。
 */
export async function generateStructured<T>(
  prompt: string,
  options: {
    responseSchema: Record<string, unknown>;
    validate: (text: string) => GenerationValidation<T>;
  }
): Promise<{ data: T | null; text: string; model: string }> {
  const { value, text, model } = await generate(
    prompt,
    {
      ...BASE_GENERATION_CONFIG,
      responseMimeType: 'application/json',
      responseSchema: options.responseSchema,
    },
    options.validate
  );
  return { data: value, text, model };
}
