'use server';

import { GeminiAPIError, generateText } from '@/lib/gemini/client';
import { buildReleaseSummaryPrompt } from '@/lib/gemini/prompts';
import { releaseSummaryKey } from '@/lib/github/cache-key';
import { fetchReleaseByTag, fetchRepository, GitHubAPIError } from '@/lib/github/client';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';
import { releaseSummaryInputSchema } from '@/lib/summary-input';

export type ReleaseSummaryResult = { ok: true; summary: string } | { ok: false; message: string };

/**
 * リリースノートのAI要約を取得する。
 *
 * コスト不変条件（ai-cost-guard）:
 * - キャッシュファースト: ReleaseSummary にヒットしたら即返す。Gemini呼び出しはミス時のみ
 * - 再生成フラグはクライアントから受け取らない
 * - プロンプトへはサーバーでGitHubから取得したデータのみを渡す
 * - 生成結果はDB保存に成功してから返す（キャッシュ迂回経路を作らない）
 */
export async function getReleaseSummary(input: unknown): Promise<ReleaseSummaryResult> {
  await requireSession();

  const parsed = releaseSummaryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: '入力が不正です' };
  }
  const { owner, name, tagName } = parsed.data;

  const cacheKey = releaseSummaryKey(owner, name, tagName);
  const cached = await prisma.releaseSummary.findUnique({ where: { cacheKey } });
  if (cached) {
    return { ok: true, summary: cached.summary };
  }

  try {
    // クライアント入力は識別子としてのみ使い、内容はGitHubから引き直す
    const [repo, release] = await Promise.all([
      fetchRepository(owner, name),
      fetchReleaseByTag(owner, name, tagName),
    ]);
    if (!repo || !release) {
      return { ok: false, message: 'リリースが見つかりませんでした' };
    }
    if (!release.body || release.body.trim() === '') {
      return { ok: false, message: 'このリリースにはリリースノートが無いため要約できません' };
    }

    const prompt = buildReleaseSummaryPrompt({
      fullName: repo.full_name,
      tagName: release.tag_name,
      name: release.name,
      body: release.body,
    });
    const { text, model } = await generateText(prompt);

    // DoD検証用: 生成が発生したときだけこのログが出る（キャッシュヒット時は出ない）
    console.info(`[summary] generated cacheKey=${cacheKey} model=${model}`);

    // 同一cacheKeyへの並行生成はupsertで最後の書き込み勝ち
    const saved = await prisma.releaseSummary.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        owner: repo.owner.login,
        repo: repo.name,
        tagName: release.tag_name,
        summary: text,
        model,
      },
      update: { summary: text, model },
    });
    return { ok: true, summary: saved.summary };
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      // GeminiAPIErrorのメッセージはユーザー向けに丸め済み
      return { ok: false, message: error.message };
    }
    if (error instanceof GitHubAPIError) {
      return { ok: false, message: error.message };
    }
    console.error(`[summary] unexpected error cacheKey=${cacheKey}:`, error);
    return { ok: false, message: '要約の生成に失敗しました' };
  }
}
