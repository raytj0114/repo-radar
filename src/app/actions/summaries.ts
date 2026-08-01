'use server';

import type { ReleaseSummary } from '@prisma/client';
import { GeminiAPIError } from '@/lib/gemini/client';
import { releaseSummaryKey } from '@/lib/github/cache-key';
import { fetchReleaseByTag, fetchRepository, GitHubAPIError } from '@/lib/github/client';
import { prisma } from '@/lib/prisma';
import { ensureReleaseSummary } from '@/lib/release-summary';
import { requireSession } from '@/lib/require-session';
import { releaseSummaryInputSchema } from '@/lib/summary-input';

/**
 * 構造化以前のキャッシュ行・構造化に失敗して縮退保存した行では
 * headline / lede が null になる（呼び出し側はテキストのみで表示する）。
 */
export type ReleaseSummaryResult =
  | {
      ok: true;
      summary: string;
      headline: string | null;
      lede: string | null;
      hasBreaking: boolean;
    }
  | { ok: false; message: string };

function toResult(record: ReleaseSummary): ReleaseSummaryResult {
  return {
    ok: true,
    summary: record.summary,
    headline: record.headline,
    lede: record.lede,
    hasBreaking: record.hasBreaking ?? false,
  };
}

/**
 * リリースノートのAI要約を取得する。
 *
 * コスト不変条件（ai-cost-guard）:
 * - キャッシュファースト: ReleaseSummary にヒットしたら即返す。生成は `ensureReleaseSummary` 経由で
 *   ミス時のみ（見出し・前文・破壊的変更フラグも同一の1回の呼び出しで得る）
 * - 再生成フラグはクライアントから受け取らない
 * - プロンプトへはサーバーでGitHubから取得したデータのみを渡す
 */
export async function getReleaseSummary(input: unknown): Promise<ReleaseSummaryResult> {
  await requireSession();

  const parsed = releaseSummaryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: '入力が不正です' };
  }
  const { owner, name, tagName } = parsed.data;

  // キャッシュヒット時はGitHubへの引き直しごと省く（ensureReleaseSummary内の確認より手前の高速経路）
  const cacheKey = releaseSummaryKey(owner, name, tagName);
  const cached = await prisma.releaseSummary.findUnique({ where: { cacheKey } });
  if (cached) return toResult(cached);

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

    const { record } = await ensureReleaseSummary({
      owner: repo.owner.login,
      repo: repo.name,
      fullName: repo.full_name,
      tagName: release.tag_name,
      name: release.name,
      body: release.body,
    });
    return toResult(record);
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
