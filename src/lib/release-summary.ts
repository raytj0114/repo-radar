import type { ReleaseSummary } from '@prisma/client';
import { generateStructured } from '@/lib/gemini/client';
import { buildReleaseSummaryPrompt, type ReleaseSummarySource } from '@/lib/gemini/prompts';
import {
  composeSummaryText,
  parseStructuredReleaseSummary,
  releaseSummaryResponseSchema,
  RELEASE_SUMMARY_PROMPT_VERSION,
} from '@/lib/gemini/structured';
import { releaseSummaryKey } from '@/lib/github/cache-key';
import { prisma } from '@/lib/prisma';

// 共有要約プール（ReleaseSummary）への唯一の書き込み口（ai-cost-guard準拠）。
// 詳細画面のServer Action（summaries.ts）と日次cron（朝刊の事前生成）の両方がここを通ることで、
// 「同じリリースを何人が見ても生成は1回」を生成経路の数によらず保証する。

/**
 * 生成元のリリース。プロンプト入力（`ReleaseSummarySource`）に、キャッシュキーと
 * 保存行の識別に使う owner / repo を加えたもの。すべてサーバーで取得したデータ
 * （クライアント入力ではない）。body が空のリリースは要約対象外なので、呼び出し側で弾いてから渡す。
 */
export type EnsureReleaseSummaryInput = ReleaseSummarySource & {
  owner: string;
  repo: string;
};

/**
 * リリースの共有要約を返す。キャッシュファーストで、未生成のときだけGeminiを1回呼ぶ。
 * 構造化に失敗した場合はテキストのみで縮退保存する（headline無し＝表示側は従来表示へフォールバック）。
 * 全滅した場合は GeminiAPIError を投げる（呼び出し側でユーザー向けに丸める／件単位でスキップする）。
 */
export async function ensureReleaseSummary(
  source: EnsureReleaseSummaryInput
): Promise<{ record: ReleaseSummary; generated: boolean }> {
  const cacheKey = releaseSummaryKey(source.owner, source.repo, source.tagName);
  const cached = await prisma.releaseSummary.findUnique({ where: { cacheKey } });
  if (cached) return { record: cached, generated: false };

  const prompt = buildReleaseSummaryPrompt({
    fullName: source.fullName,
    tagName: source.tagName,
    name: source.name,
    body: source.body,
  });
  const { data, text, model } = await generateStructured(prompt, {
    responseSchema: releaseSummaryResponseSchema,
    validate: parseStructuredReleaseSummary,
  });

  // DoD検証用: 生成が発生したときだけこのログが出る（キャッシュヒット時は出ない）
  console.info(
    `[summary] generated cacheKey=${cacheKey} model=${model} structured=${data !== null}`
  );

  const values = {
    summary: data ? composeSummaryText(data.lines) : text,
    headline: data?.headline ?? null,
    lede: data?.lede ?? null,
    hasBreaking: data?.hasBreaking ?? null,
    promptVersion: RELEASE_SUMMARY_PROMPT_VERSION,
    model,
  };

  // 同一cacheKeyへの並行生成はupsertで最後の書き込み勝ち
  const record = await prisma.releaseSummary.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      owner: source.owner,
      repo: source.repo,
      tagName: source.tagName,
      ...values,
    },
    update: values,
  });
  return { record, generated: true };
}
