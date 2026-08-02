import type { FavoriteRepo, ReleaseSummary } from '@prisma/client';
import { z } from 'zod';
import {
  digestDayOf,
  digestWindowsFor,
  releasesInWindow,
  type DigestWindow,
} from '@/lib/digest-window';
import { dailyDigestKey, releaseSummaryKey } from '@/lib/github/cache-key';
import { fetchReleases } from '@/lib/github/client';
import type { Release } from '@/lib/github/schemas';
import { prisma } from '@/lib/prisma';
import { ensureReleaseSummary } from '@/lib/release-summary';
import { collectStarSnapshots, type StarSnapshotResult } from '@/lib/star-snapshot';

// デイリーダイジェスト＝「朝刊」の組み立て（Issue #30 / #36 / ai-cost-guard準拠）。
// AI呼び出しは共有要約（ReleaseSummary）が未生成のリリース数にのみ比例し、
// ユーザーごとのダイジェストは要約を組み立てるだけでLLMを呼ばない。
// 組み立てはAIコストゼロなので毎回冪等にやり直し、改善するときだけ上書きする（Issue #36）。
// 収集窓の計算は src/lib/digest-window.ts（純関数）に分離してある（Issue #31）。

// 既存のimport元（テスト・cron route）との互換のため、窓関連はここからも公開する
export {
  digestDayOf,
  digestWindowFor,
  digestWindowsFor,
  releasesInWindow,
  type DigestWindow,
} from '@/lib/digest-window';

/**
 * 窓の正確性を優先し、cron経路はfetchキャッシュを使わない（fresh。Issue #36 指摘3）。
 * 48時間ぶん（当日窓+前日バックフィル）のリリースは先頭1ページ（最新100件）で必ず収まる
 */
const DIGEST_RELEASE_FETCH = { perPage: 100, maxPages: 1, fresh: true } as const;

/**
 * 朝刊の1エントリ。DailyDigest.entries（Json列）にはこの配列を保存する。
 * summary が null のリリースは noteless で区別する:
 * true は本文なし（要約対象外）、false は生成失敗（翌日のバックフィルで自動再試行される）。
 * noteless は #36 で追加したためoptional。欠落した旧エントリは表示側で「リリースノートなし」に倒す。
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
  /** 前文（一面トップの導入文）。#31で追加したためoptional。欠落した旧エントリは前文なしで組む */
  lede: z.string().nullable().optional(),
  summary: z.string().nullable(),
  hasBreaking: z.boolean().nullable(),
  noteless: z.boolean().optional(),
});

export const digestEntriesSchema = z.array(digestEntrySchema);

export type DigestEntry = z.infer<typeof digestEntrySchema>;

/** リポジトリの同一性判定。cacheKeyと同じ正規化（小文字）で全ユーザー横断の重複を排除する */
function repoKeyOf(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase();
}

type FavoriteRepoRef = Pick<FavoriteRepo, 'owner' | 'name' | 'fullName'>;
type SummaryRef = Pick<ReleaseSummary, 'summary' | 'headline' | 'lede' | 'hasBreaking'>;

/**
 * 1ユーザー分の朝刊エントリを組み立てる（純関数・LLM呼び出しなし）。
 * `releasesByRepo` は `repoKeyOf`、`summariesByKey` は `releaseSummaryKey` をキーにする。
 * 要約が無いリリースも summary=null で載せ、リリースの発生自体は報じる。
 * ケース違いで同じリポジトリを二重にお気に入りしていても1回だけ数える（Issue #36 指摘4）。
 */
export function assembleDigestEntries(
  favorites: readonly FavoriteRepoRef[],
  releasesByRepo: ReadonlyMap<string, Release[]>,
  summariesByKey: ReadonlyMap<string, SummaryRef>
): DigestEntry[] {
  const entries: DigestEntry[] = [];
  const seenRepos = new Set<string>();
  for (const favorite of favorites) {
    const repoKey = repoKeyOf(favorite.owner, favorite.name);
    if (seenRepos.has(repoKey)) continue;
    seenRepos.add(repoKey);
    const releases = releasesByRepo.get(repoKey) ?? [];
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
        lede: summary?.lede ?? null,
        summary: summary?.summary ?? null,
        hasBreaking: summary?.hasBreaking ?? null,
        noteless: !release.body || release.body.trim() === '',
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

/** エントリ同士のリリース同一性。cacheKeyと同じ正規化 */
function entryKeyOf(entry: DigestEntry): string {
  return releaseSummaryKey(entry.owner, entry.repo, entry.tagName);
}

/**
 * エントリの全フィールド一致。jsonbはオブジェクトのキー順・配列外の順序を保証しないため、
 * JSON文字列比較ではなくフィールド単位で比べる（noteless の欠落は null に正規化）
 */
function entryEquals(a: DigestEntry, b: DigestEntry): boolean {
  return (
    a.owner === b.owner &&
    a.repo === b.repo &&
    a.fullName === b.fullName &&
    a.tagName === b.tagName &&
    a.releaseName === b.releaseName &&
    a.publishedAt === b.publishedAt &&
    a.headline === b.headline &&
    (a.lede ?? null) === (b.lede ?? null) &&
    a.summary === b.summary &&
    a.hasBreaking === b.hasBreaking &&
    (a.noteless ?? null) === (b.noteless ?? null)
  );
}

/**
 * 既存ダイジェストと再組み立て結果の比較（純関数。Issue #36 指摘1・2の中核）。
 * - `equal`: 完全一致（エントリ順序には依存しない）。書き込み不要
 * - `improved`: 旧のリリースを1つも失わず、要約の後退（非null→null）も無い変化。上書きして修復する
 * - `regressed`: リリースの消失または要約の後退を含む。旧を保持する
 *   （取得失敗でリリースが欠けた再実行が、配達済みの朝刊を削らないようにするため）
 */
export function compareDigestEntries(
  oldEntries: readonly DigestEntry[],
  newEntries: readonly DigestEntry[]
): 'equal' | 'improved' | 'regressed' {
  const newByKey = new Map(newEntries.map((entry) => [entryKeyOf(entry), entry]));
  let identical = oldEntries.length === newEntries.length;
  for (const oldEntry of oldEntries) {
    const newEntry = newByKey.get(entryKeyOf(oldEntry));
    if (!newEntry) return 'regressed';
    if (oldEntry.summary !== null && newEntry.summary === null) return 'regressed';
    if (identical && !entryEquals(oldEntry, newEntry)) identical = false;
  }
  return identical ? 'equal' : 'improved';
}

/** 窓ごとのダイジェスト書き込み結果 */
export type DigestWindowResult = {
  date: string;
  digests: {
    created: number;
    repaired: number;
    unchanged: number;
    kept: number;
    noActivity: number;
    failed: number;
  };
};

export type DailyDigestRunResult = {
  date: string;
  windows: DigestWindowResult[];
  users: number;
  repos: { total: number; fetchFailed: number };
  releases: number;
  summaries: { generated: number; cached: number; noteless: number; failed: number };
  /** 星数スナップショットの採取結果（Issue #39）。null = フェーズごと失敗（朝刊は続行済み） */
  stars: StarSnapshotResult | null;
};

/**
 * 日次cronの本体。
 * 1. 全ユーザー横断でお気に入りリポジトリをユニーク化する
 * 2. 当日窓の星数スナップショットを採取する（Issue #39）
 * 3. 48時間（前日窓+当日窓）のリリースを取得する
 * 4. 未生成のリリースだけ共有要約を生成（AI呼び出しはここだけ＝新規リリース数にのみ比例）
 * 5. 窓ごと・ユーザーごとに朝刊を組み立て、改善するときだけ書き込む（LLM呼び出しゼロ・冪等）
 */
export async function runDailyDigest(now: Date): Promise<DailyDigestRunResult> {
  const windows = digestWindowsFor(now);
  // リリース抽出と要約は前日窓start〜当日窓endの連続48時間で1回だけ行う
  const combinedWindow: DigestWindow = {
    start: windows[0].start,
    end: windows[windows.length - 1].end,
  };

  const favorites = await prisma.favoriteRepo.findMany();

  // 全ユーザー横断のユニークリポジトリ。表記は最初に現れたお気に入りのものを使う
  const uniqueRepos = new Map<string, FavoriteRepoRef>();
  for (const favorite of favorites) {
    const key = repoKeyOf(favorite.owner, favorite.name);
    if (!uniqueRepos.has(key)) uniqueRepos.set(key, favorite);
  }
  const repoList = [...uniqueRepos.entries()];

  // 星数の採取（Issue #39）。ここだけは意図的に後続と直列にする:
  // スナップショットは訂正不能な点データで、取り逃した日は永久に欠測になる。
  // タイムアウトしたときに、回復不能な採取を先に済ませ、翌日のバックフィルで回復できる
  // 朝刊の生成を後に回すため（「独立な取得は直列にawaitしない」原則の意図的な例外）。
  // 採取自体の失敗は朝刊を止めない
  let stars: StarSnapshotResult | null = null;
  try {
    stars = await collectStarSnapshots(
      windows[windows.length - 1],
      repoList.map(([, repo]) => repo)
    );
  } catch (error) {
    console.error('[digest] star snapshot phase failed:', error);
  }

  // 48時間ぶんのリリース取得。失敗したリポジトリはこの回の朝刊から漏れるが、全体は止めない
  // （配達済みの朝刊は compareDigestEntries の regressed 判定が守る）
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
    releasesByRepo.set(key, releasesInWindow(result.value ?? [], combinedWindow));
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
        // 要約に失敗してもエントリ自体は載せる（リリースの発生は報じ、バックフィルで再試行する）
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

  const windowResults: DigestWindowResult[] = [];
  for (const window of windows) {
    windowResults.push(
      await writeDigestsForWindow(window, favoritesByUser, releasesByRepo, summariesByKey)
    );
  }

  return {
    date: digestDayOf(windows[windows.length - 1]),
    windows: windowResults,
    users: favoritesByUser.size,
    repos: { total: uniqueRepos.size, fetchFailed },
    releases: [...releasesByRepo.values()].reduce((sum, list) => sum + list.length, 0),
    summaries: summaryCounts,
    stars,
  };
}

/**
 * 1つの窓のダイジェストを全ユーザー分書き込む。
 * 既存行は再組み立て結果と比較し、改善するときだけ上書きする（冪等・自己修復）。
 * #30以前の旧形式行（entries=null・contentのみ）は表示互換のため決して触らない。
 */
async function writeDigestsForWindow(
  window: DigestWindow,
  favoritesByUser: ReadonlyMap<string, FavoriteRepo[]>,
  releasesByRepo: ReadonlyMap<string, Release[]>,
  summariesByKey: ReadonlyMap<string, SummaryRef>
): Promise<DigestWindowResult> {
  const day = digestDayOf(window);
  const releasesInThisWindow = new Map(
    [...releasesByRepo].map(([key, releases]) => [key, releasesInWindow(releases, window)])
  );

  const existingRows = await prisma.dailyDigest.findMany({
    where: {
      cacheKey: {
        in: [...favoritesByUser.keys()].map((userId) => dailyDigestKey(window.end, userId)),
      },
    },
    select: { cacheKey: true, entries: true, content: true },
  });
  const existingByKey = new Map(existingRows.map((row) => [row.cacheKey, row]));

  const counts = { created: 0, repaired: 0, unchanged: 0, kept: 0, noActivity: 0, failed: 0 };
  for (const [userId, userFavorites] of favoritesByUser) {
    const cacheKey = dailyDigestKey(window.end, userId);
    try {
      const existing = existingByKey.get(cacheKey);
      // 旧形式行（entriesなし・contentのみ）は上書きしない
      if (existing && existing.entries === null && existing.content !== null) {
        counts.kept += 1;
        continue;
      }

      const entries = assembleDigestEntries(userFavorites, releasesInThisWindow, summariesByKey);
      let outcome: 'created' | 'repaired';
      if (!existing) {
        if (entries.length === 0) {
          counts.noActivity += 1;
          continue;
        }
        outcome = 'created';
      } else {
        // 既存entriesが検証に通らない（壊れている）行だけは improved 扱いで作り直す
        const parsed = digestEntriesSchema.safeParse(existing.entries);
        const verdict = parsed.success ? compareDigestEntries(parsed.data, entries) : 'improved';
        if (verdict === 'equal') {
          counts.unchanged += 1;
          continue;
        }
        if (verdict === 'regressed' || entries.length === 0) {
          // 配達済みの朝刊を削る変更はしない（取得失敗などの一時的な欠落から守る）
          counts.kept += 1;
          continue;
        }
        outcome = 'repaired';
      }

      // DoD検証用: 書き込み時のログ。ここに [summary] generated が伴わない＝追加のAI呼び出しゼロの証跡
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
      counts[outcome] += 1;
    } catch (error) {
      // 1ユーザーの失敗で他ユーザーの朝刊を止めない
      counts.failed += 1;
      console.error(`[digest] assembly failed cacheKey=${cacheKey}:`, error);
    }
  }
  return { date: day, digests: counts };
}
