import { generateText } from '@/lib/gemini/client';
import { buildDailyDigestPrompt, type DigestEntry } from '@/lib/gemini/prompts';
import { dailyDigestKey } from '@/lib/github/cache-key';
import { fetchReleases } from '@/lib/github/client';
import type { Release } from '@/lib/github/schemas';
import { prisma } from '@/lib/prisma';

// デイリーダイジェスト生成（ai-cost-guard準拠）。
// AI呼び出し回数 = 「その日に新規リリースがあったユーザー」数にのみ比例する。

/** 指定したUTC日付に公開されたリリースのみを抽出する（draftのpublished_at=nullは除外） */
export function releasesPublishedOn(releases: Release[], date: Date): Release[] {
  const day = date.toISOString().slice(0, 10);
  return releases.filter((release) => release.published_at?.slice(0, 10) === day);
}

export type DigestGenerationResult = 'generated' | 'cached' | 'no-favorites' | 'no-activity';

/**
 * 1ユーザー分の当日ダイジェストを生成してDBへ保存する。
 * キャッシュファースト: 既に同じ日のダイジェストがあればGeminiを呼ばない。
 * 当日リリースが無い場合もGeminiを呼ばない（保存もしない）。
 */
export async function generateDailyDigest(
  userId: string,
  date: Date
): Promise<DigestGenerationResult> {
  const cacheKey = dailyDigestKey(date, userId);
  const existing = await prisma.dailyDigest.findUnique({ where: { cacheKey } });
  if (existing) return 'cached';

  const favorites = await prisma.favoriteRepo.findMany({ where: { userId } });
  if (favorites.length === 0) return 'no-favorites';

  const settled = await Promise.allSettled(
    favorites.map(async (favorite) => ({
      favorite,
      releases: await fetchReleases(favorite.owner, favorite.name),
    }))
  );

  const entries: DigestEntry[] = [];
  for (const result of settled) {
    // 取得に失敗したリポジトリは当日分から除く（全体は止めない）
    if (result.status !== 'fulfilled') {
      console.error(`[digest] release fetch failed userId=${userId}:`, result.reason);
      continue;
    }
    const { favorite, releases } = result.value;
    for (const release of releasesPublishedOn(releases ?? [], date)) {
      entries.push({
        fullName: favorite.fullName,
        tagName: release.tag_name,
        name: release.name,
        body: release.body ?? '',
      });
    }
  }
  if (entries.length === 0) return 'no-activity';

  const day = date.toISOString().slice(0, 10);
  const prompt = buildDailyDigestPrompt({ date: day, entries });
  const { text, model } = await generateText(prompt);

  // DoD検証用: 生成が発生したときだけこのログが出る（キャッシュヒット時は出ない）
  console.info(`[digest] generated cacheKey=${cacheKey} model=${model} entries=${entries.length}`);

  // 同一cacheKeyへの並行生成はupsertで最後の書き込み勝ち
  await prisma.dailyDigest.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      userId,
      date: new Date(`${day}T00:00:00.000Z`),
      content: text,
      model,
    },
    update: { content: text, model },
  });
  return 'generated';
}
