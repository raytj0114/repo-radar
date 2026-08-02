import { digestDayOf, type DigestWindow } from '@/lib/digest-window';
import { fetchRepository, searchTrendingRepositories } from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import { prisma } from '@/lib/prisma';

// 星数の日次スナップショット（Issue #39）。RepoStarSnapshot への唯一の書き込み口。
//
// 相場欄の前日比（表示は別Issue）の材料で、AI呼び出しは無く、記録量は銘柄数にのみ比例する。
// **バックフィル不能**: 過去日の星数はGitHub APIから取得できないため、採り逃した日は永久に欠測になる。
// #36 の「翌日の実行で自動修復する」枠組みが効かない初のデータなので、
// 呼び出し側（runDailyDigest）は要約生成より前にこのフェーズを置く。

/**
 * 採取するトレンド銘柄数。相場欄の表示は6行だが、順位の入れ替わりで翌日の前日比が
 * 欠けないよう広めに採る（検索は per_page が増えても1リクエストのまま）。
 */
const TRENDING_SNAPSHOT_LIMIT = 30;

/** トレンドの観測窓（日）。相場欄・/trending と同じ30日窓に揃える */
const TRENDING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 1銘柄の観測値。fullName は `normalizeFullName` 適用後 */
export type StarObservation = {
  fullName: string;
  stars: number;
};

/** 採取対象のリポジトリ（FavoriteRepo をそのまま渡せる形） */
export type StarSnapshotTarget = {
  owner: string;
  name: string;
};

export type StarSnapshotResult = {
  /** 観測日（YYYY-MM-DD。収集窓の終端のUTC日付） */
  date: string;
  /** 星数を観測できた銘柄数（= upsertを試みた行数） */
  observed: number;
  /** 保存できた行数 */
  written: number;
  /** 星数を取得できなかったお気に入り数（取得失敗・404） */
  fetchFailed: number;
  /** 保存に失敗した行数 */
  writeFailed: number;
  /** トレンド検索に失敗した（= この日はトレンド銘柄が欠測になる） */
  trendingFailed: boolean;
};

/**
 * リポジトリの同一性キー。GitHubは owner/repo を大小非区別で扱うため小文字化しても情報を失わず、
 * ケース違いのお気に入り（例: "Vercel/Next.js"）が別行にならない。
 * src/lib/digest.ts の repoKeyOf・cache-key.ts の正規化と同じ規則。
 */
export function normalizeFullName(fullName: string): string {
  return fullName.trim().toLowerCase();
}

/**
 * 採取対象の集合を作る（純関数）。トレンドとお気に入りは重なりうるので正規化して重複排除し、
 * 先に現れたトレンド側の観測を優先する（同時刻の観測なので値は実質同じ）。
 * 並びはfullName昇順に固定して、書き込み順とログを実行ごとにぶれさせない。
 */
export function mergeStarObservations(
  trending: readonly StarObservation[],
  favorites: readonly StarObservation[]
): StarObservation[] {
  const byFullName = new Map<string, StarObservation>();
  for (const observation of [...trending, ...favorites]) {
    const fullName = normalizeFullName(observation.fullName);
    if (!byFullName.has(fullName)) {
      byFullName.set(fullName, { fullName, stars: observation.stars });
    }
  }
  return [...byFullName.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * その日の星数を採取して保存する。観測名目時刻は収集窓の終端（21:00 UTC）固定。
 *
 * - 取得はトレンド検索（1リクエスト）とお気に入りのリポジトリメタ（1リポジトリ1リクエスト）を同時に投げる
 * - どちらも Data Cache をバイパスする（`fresh`）。訂正不能な点データを古い値で焼き付けないため
 * - 同日の再実行（手動叩き・リトライ）は upsert で冪等。名目時刻が固定なので上書きしても害はない
 * - 銘柄単位・行単位で失敗を隔離する（1件の失敗で他の銘柄を落とさない）
 */
export async function collectStarSnapshots(
  window: DigestWindow,
  repos: readonly StarSnapshotTarget[]
): Promise<StarSnapshotResult> {
  const day = digestDayOf(window);

  const [trendingSettled, favoriteSettled] = await Promise.all([
    settle(
      searchTrendingRepositories({
        createdAfter: new Date(window.end.getTime() - TRENDING_WINDOW_DAYS * DAY_MS),
        perPage: TRENDING_SNAPSHOT_LIMIT,
        fresh: true,
      })
    ),
    Promise.allSettled(
      repos.map((repo) => fetchRepository(repo.owner, repo.name, { fresh: true }))
    ),
  ]);

  // トレンド（searchプール）の失敗はお気に入り（coreプール）の採取を巻き込まない
  const trending: StarObservation[] = [];
  const trendingFailed = trendingSettled.status === 'rejected';
  if (trendingSettled.status === 'fulfilled') {
    for (const item of trendingSettled.value.items) {
      trending.push({ fullName: item.full_name, stars: item.stargazers_count });
    }
  } else {
    console.error('[stars] trending fetch failed:', trendingSettled.reason);
  }

  let fetchFailed = 0;
  const favorites: StarObservation[] = [];
  favoriteSettled.forEach((result, index) => {
    const repo = repos[index];
    if (result.status === 'rejected') {
      fetchFailed += 1;
      console.error(
        `[stars] repository fetch failed repo=${repo.owner}/${repo.name}:`,
        result.reason
      );
      return;
    }
    // null はリポジトリ消滅・改名（404）。観測できないので欠測として数えるだけ
    if (result.value === null) {
      fetchFailed += 1;
      return;
    }
    favorites.push({ fullName: result.value.full_name, stars: result.value.stargazers_count });
  });

  const observations = mergeStarObservations(trending, favorites);
  const date = new Date(`${day}T00:00:00.000Z`);
  let written = 0;
  let writeFailed = 0;
  for (const { fullName, stars } of observations) {
    try {
      await prisma.repoStarSnapshot.upsert({
        where: { fullName_date: { fullName, date } },
        create: { fullName, stars, date },
        update: { stars },
      });
      written += 1;
    } catch (error) {
      writeFailed += 1;
      console.error(`[stars] snapshot write failed repo=${fullName} date=${day}:`, error);
    }
  }

  // DoD検証用: 採取フェーズが1回のcronで1度だけ走ったことの証跡
  console.info(`[stars] collected date=${day} observed=${observations.length} written=${written}`);

  return {
    date: day,
    observed: observations.length,
    written,
    fetchFailed,
    writeFailed,
    trendingFailed,
  };
}
