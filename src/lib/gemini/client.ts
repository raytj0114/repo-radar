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

const responseSchema = z.object({
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * テキスト生成。429/5xx/ネットワークエラーはモデルごとに最大2回試行し、
 * プライマリで失敗し続けたらフォールバックモデルで再試行する。
 * 上流のエラー本文はUIへ透過しない（サーバーログのみ）。
 */
export async function generateText(prompt: string): Promise<{ text: string; model: string }> {
  let lastStatus = 0;

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
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1024,
              thinkingConfig: { thinkingBudget: 0 },
            },
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
        const parsed = responseSchema.safeParse(await res.json().catch(() => null));
        const text = parsed.success
          ? parsed.data.candidates[0].content.parts
              .map((part) => part.text ?? '')
              .join('')
              .trim()
          : '';
        if (text !== '') {
          return { text, model };
        }
        // 空応答・想定外の形式はリトライ対象
        console.error(`[gemini] ${model} attempt=${attempt}: empty or unexpected response`);
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

  throw new GeminiAPIError(
    lastStatus || 502,
    lastStatus === 429 ? 'しばらく時間をおいて再試行してください' : '要約の生成に失敗しました'
  );
}
