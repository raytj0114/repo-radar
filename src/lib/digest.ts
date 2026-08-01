import type { FavoriteRepo, ReleaseSummary } from '@prisma/client';
import { z } from 'zod';
import { dailyDigestKey, releaseSummaryKey } from '@/lib/github/cache-key';
import { fetchReleases } from '@/lib/github/client';
import type { Release } from '@/lib/github/schemas';
import { prisma } from '@/lib/prisma';
import { ensureReleaseSummary } from '@/lib/release-summary';

// デイリーダイジェスト＝「朝刊」の組み立て（Issue #30 / ai-cost-guard準拠）。
// AI呼び出しは共有要約（ReleaseSummary）が未生成のリリース数にのみ比例し、
// ユーザーごとのダイジェストは要約を組み立てるだけでLLMを呼ばない。

/** 収集窓の終端時刻（UTC）。vercel.json のcron（`0 21 * * *`）と対にする */
const WINDOW_END_HOUR_UTC = 21;

/** 24時間窓のリリースはリリース一覧の先頭1ページ（最新100件）で必ず収まる */
const DIGEST_RELEASE_FETCH = { perPage: 100, maxPages: 1 } as const;

/** 半開区間 (start, end]。startちょうどは前日の窓、endちょうどは当日の窓に属する */
export type DigestWindow = { start: Date; end: Date };

/**
 * 実行時刻から収集窓を決める。end = now以前の直近21:00 UTC、start = その24時間前。
 * cronの発火が数分遅れても同じ窓・同じダイジェスト日付に丸まる。
 * 21:00 UTCより前に手動実行した場合は前日分の窓になる（部分的な当日窓を作らない）。
 */
export function digestWindowFor(now: Date): DigestWindow {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), WINDOW_END_HOUR_UTC)
  );
  if (end.getTime() > now.getTime()) {
    end.setUTCDate(end.getUTCDate() - 1);
  }
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start, end };
}

/** ダイジェストの帰属日（YYYY-MM-DD）。窓の終端のUTC日付で、cacheKey・date列に使う */
export function digestDayOf(window: DigestWindow): string {
  return window.end.toISOString().slice(0, 10);
}

/** 窓内（start排他・end包含）に公開されたリリースのみ抽出する（draftのpublished_at=nullは除外） */
export function releasesInWindow(releases: Release[], window: DigestWindow): Release[] {
  return releases.filter((release) => {
    if (!release.published_at) return false;
    const publishedAt = Date.parse(release.published_at);
    return window.start.getTime() < publishedAt && publishedAt <= window.end.getTime();
  });
}

/**
 * 朝刊の1エントリ。DailyDigest.entries（Json列）にはこの配列を保存する。
 * summary が null のリリース（本文なし・生成失敗）はリンクのみで「リリースノートなし」と表示する。
 */
export const digestEntrySchema = z.object({
  /** リポジトリ詳細（/repos/[owner]/[name]）へのリンク用。FavoriteRepo由来の表記のまま */
  owner: z.string(),
  repo: z.string(),
  fullName: z.string(),
  tagName: z.string(),
  releaseName: z.string().nullable(),
  /** ISO 8601。窓内リリースのみを載せるため必ず値がある */
  publishedAt: z.string(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  hasBreaking: z.boolean().nullable(),
});

export const digestEntriesSchema = z.array(digestEntrySchema);

export type DigestEntry = z.infer<typeof digestEntrySchema>;

/** リポジトリの同一性判定。cacheKeyと同じ正規化（小文字）で全ユーザー横断の重複を排除する */
function repoKeyOf(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase();
}

type FavoriteRepoRef = Pick<FavoriteRepo, 'owner' | 'name' | 'fullName'>;
type SummaryRef = Pick<ReleaseSummary, 'summary' | 'headline' | 'hasBreaking'>;

/**
 * 1ユーザー分の朝刊エントリを組み立てる（純関数・LLM呼び出しなし）。
 * `releasesByRepo` は `repoKeyOf`、`summariesByKey` は `releaseSummaryKey` をキーにする。
 * 要約が無いリリースも summary=null で載せ、リリースの発生自体は報じる。
 */
export function assembleDigestEntries(
  favorites: readonly FavoriteRepoRef[],
  releasesByRepo: ReadonlyMap<string, Release[]>,
  summariesByKey: ReadonlyMap<string, SummaryRef>
): DigestEntry[] {
  const entries: DigestEntry[] = [];
  for (const favorite of favorites) {
    const releases = releasesByRepo.get(repoKeyOf(favorite.owner, favorite.name)) ?? [];
    for (const release of releases) {
      // releasesInWindow で抽出済みだが、published_at の非nullは型の上でもここで保証する
      if (!release.published_at) continue;
      const summary = summariesByKey.get(
        releaseSummaryKey(favorite.owner, favorite.name, release.tag_name)
      );
      entries.push({
        owner: favorite.owner,
        repo: favorite.name,
        fullName: favorite.fullName,
        tagName: release.tag_name,
        releaseName: release.name,
        publishedAt: release.published_at,
        headline: summary?.headline ?? null,
        summary: summary?.summary ?? null,
        hasBreaking: summary?.hasBreaking ?? null,
      });
    }
  }
  return entries.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** 冒頭の総括（ルールベース）。例: 「3リポジトリ・5リリース（うち破壊的変更1件）」 */
export function composeDigestOverview(entries: readonly DigestEntry[]): string {
  const repoCount = new Set(entries.map((entry) => repoKeyOf(entry.owner, entry.repo))).size;
  const breakingCount = entries.filter((entry) => entry.hasBreaking === true).length;
  const base = `${repoCount}リポジトリ・${entries.length}リリース`;
  return breakingCount > 0 ? `${base}（うち破壊的変更${breakingCount}件）` : base;
}

export type DailyDigestRunResult = {
  date: string;
  window: { start: string; end: string };
  users: number;
  repos: { total: number; fetchFailed: number };
  releases: number;
  summaries: { generated: number; cached: number; noteless: number; failed: number };
  digests: { generated: number; cached: number; noActivity: number; failed: number };
};

/**
 * 日次cronの本体。
 * 1. 全ユーザー横断でお気に入りリポジトリをユニーク化し、窓内リリースを取得（リポジトリごとに1リクエスト）
 * 2. 未生成のリリースだけ共有要約を生成（AI呼び出しはここだけ＝新規リリース数にのみ比例）
 * 3. ユーザーごとに朝刊エントリを組み立てて保存（LLM呼び出しゼロ）
 */
export async function runDailyDigest(now: Date): Promise<DailyDigestRunResult> {
  const window = digestWindowFor(now);
  const day = digestDayOf(window);

  const favorites = await prisma.favoriteRepo.findMany();

  // 全ユーザー横断のユニークリポジトリ。表記は最初に現れたお気に入りのものを使う
  const uniqueRepos = new Map<string, FavoriteRepoRef>();
  for (const favorite of favorites) {
    const key = repoKeyOf(favorite.owner, favorite.name);
    if (!uniqueRepos.has(key)) uniqueRepos.set(key, favorite);
  }
  const repoList = [...uniqueRepos.entries()];

  // 窓内リリースの取得。失敗したリポジトリはその日の朝刊から漏れるが、全体は止めない
  let fetchFailed = 0;
  const releasesByRepo = new Map<string, Release[]>();
  const settled = await Promise.allSettled(
    repoList.map(([, repo]) => fetchReleases(repo.owner, repo.name, DIGEST_RELEASE_FETCH))
  );
  settled.forEach((result, index) => {
    const [key, repo] = repoList[index];
    if (result.status !== 'fulfilled') {
      fetchFailed += 1;
      console.error(`[digest] release fetch failed repo=${repo.fullName}:`, result.reason);
      return;
    }
    releasesByRepo.set(key, releasesInWindow(result.value ?? [], window));
  });

  // 共有要約の生成（逐次）。本文が空のリリースは従来どおり要約せず、リンクのみ載せる
  const summaryCounts = { generated: 0, cached: 0, noteless: 0, failed: 0 };
  const summariesByKey = new Map<string, SummaryRef>();
  for (const [key, repo] of repoList) {
    for (const release of releasesByRepo.get(key) ?? []) {
      if (!release.body || release.body.trim() === '') {
        summaryCounts.noteless += 1;
        continue;
      }
      try {
        const { record, generated } = await ensureReleaseSummary({
          owner: repo.owner,
          repo: repo.name,
          fullName: repo.fullName,
          tagName: release.tag_name,
          name: release.name,
          body: release.body,
        });
        summariesByKey.set(releaseSummaryKey(repo.owner, repo.name, release.tag_name), record);
        summaryCounts[generated ? 'generated' : 'cached'] += 1;
      } catch (error) {
        // 要約に失敗してもエントリ自体は載せる（リリースの発生は報じる）
        summaryCounts.failed += 1;
        console.error(
          `[digest] summary generation failed repo=${repo.fullName} tag=${release.tag_name}:`,
          error
        );
      }
    }
  }

  const favoritesByUser = new Map<string, FavoriteRepo[]>();
  for (const favorite of favorites) {
    const list = favoritesByUser.get(favorite.userId);
    if (list) {
      list.push(favorite);
    } else {
      favoritesByUser.set(favorite.userId, [favorite]);
    }
  }

  // 既存ダイジェストの一括確認（キャッシュファースト。再実行しても上書き生成しない）
  const existing = await prisma.dailyDigest.findMany({
    where: {
      cacheKey: {
        in: [...favoritesByUser.keys()].map((userId) => dailyDigestKey(window.end, userId)),
      },
    },
    select: { cacheKey: true },
  });
  const existingKeys = new Set(existing.map((digest) => digest.cacheKey));

  const digestCounts = { generated: 0, cached: 0, noActivity: 0, failed: 0 };
  for (const [userId, userFavorites] of favoritesByUser) {
    const cacheKey = dailyDigestKey(window.end, userId);
    if (existingKeys.has(cacheKey)) {
      digestCounts.cached += 1;
      continue;
    }
    try {
      const entries = assembleDigestEntries(userFavorites, releasesByRepo, summariesByKey);
      if (entries.length === 0) {
        digestCounts.noActivity += 1;
        continue;
      }
      // DoD検証用: 組み立て時のログ。ここに [summary] generated が伴わない＝追加のAI呼び出しゼロの証跡
      console.info(`[digest] assembled cacheKey=${cacheKey} entries=${entries.length}`);
      // 同一cacheKeyへの並行実行はupsertで最後の書き込み勝ち
      await prisma.dailyDigest.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          userId,
          date: new Date(`${day}T00:00:00.000Z`),
          entries,
        },
        update: { entries },
      });
      digestCounts.generated += 1;
    } catch (error) {
      // 1ユーザーの失敗で他ユーザーの朝刊を止めない
      digestCounts.failed += 1;
      console.error(`[digest] assembly failed userId=${userId}:`, error);
    }
  }

  return {
    date: day,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    users: favoritesByUser.size,
    repos: { total: uniqueRepos.size, fetchFailed },
    releases: [...releasesByRepo.values()].reduce((sum, list) => sum + list.length, 0),
    summaries: summaryCounts,
    digests: digestCounts,
  };
}
