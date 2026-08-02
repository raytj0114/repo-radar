import { digestDayOf, type DigestWindow } from '@/lib/digest-window';
import { fetchRepository, searchTrendingRepositories } from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import { MARKET_WINDOW_DAYS } from '@/lib/paper';
import { prisma } from '@/lib/prisma';

// 星数の日次スナップショット（Issue #39）。RepoStarSnapshot への唯一の書き込み口。
//
// 相場欄の前日比（表示は別Issue）の材料で、AI呼び出しは無く、記録量は銘柄数にのみ比例する。
// **バックフィル不能**: 過去日の星数はGitHub APIから取得できないため、採り逃した日は永久に欠測になる。
// #36 の「翌日の実行で自動修復する」枠組みが効かない初のデータなので、
// 呼び出し側（runDailyDigest）は要約生成より前にこのフェーズを置く。

/**
 * 採取するトレンド銘柄数。相場欄の表示（`MARKET_ROW_LIMIT` = 6行）より深く採るのは、
 * 順位の入れ替わりで翌日の前日比が欠けないようにするため（検索は per_page が
 * 増えても1リクエストのまま）。**この値は常に相場欄の行数より十分大きく保つ**。
 */
const TRENDING_SNAPSHOT_LIMIT = 30;

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
  /** 星数を観測できた銘柄数（= 書き込みを試みた行数） */
  observed: number;
  /** 新しく記録した行数。既存行は先勝ちでスキップするので、同日の再実行では0になる */
  written: number;
  /** 星数を取得できなかったお気に入り数（取得失敗・404） */
  fetchFailed: number;
  /** 保存に失敗した行数（一括書き込みなので observed 全件か0） */
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
 * 採取対象の集合を作る（純関数）。トレンドとお気に入りは重なりうるので正規化して重複排除する。
 * 重なった銘柄では**お気に入り側を優先する**: `/repos/{owner}/{repo}` の直接読みが正で、
 * `/search/repositories` の星数は非同期に更新される二次インデックス越しの値だから
 * （`fresh` で無効化できるのはNextのData Cacheだけで、GitHub側のインデックス遅れには効かない）。
 * 並びはfullName昇順に固定して、書き込み順とログを実行ごとにぶれさせない。
 */
export function mergeStarObservations(
  trending: readonly StarObservation[],
  favorites: readonly StarObservation[]
): StarObservation[] {
  const byFullName = new Map<string, StarObservation>();
  for (const observation of [...favorites, ...trending]) {
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
 * - 保存は**先勝ち**（`skipDuplicates` = ON CONFLICT DO NOTHING）。同日の再実行は冪等だが、
 *   既存行は決して上書きしない。窓は `[D 21:00, D+1 21:00)` の24時間あるため、日中に手で叩くと
 *   「Dの21:00の観測」として何時間も後の星数を焼き付けてしまう（訂正不能・痕跡も残らない）。
 *   21:00 UTCに最も近い最初の観測を正とし、再実行は欠けた行の補修だけを行う
 * - 銘柄単位で失敗を隔離する（1件の取得失敗で他の銘柄を落とさない）
 */
export async function collectStarSnapshots(
  window: DigestWindow,
  repos: readonly StarSnapshotTarget[]
): Promise<StarSnapshotResult> {
  const day = digestDayOf(window);

  const [trendingSettled, favoriteSettled] = await Promise.all([
    settle(
      searchTrendingRepositories({
        // 相場欄は描画時刻起点、採取は窓終端起点。採取側が常に等しいか広くなる向きなので、
        // 表示銘柄は採取集合に含まれる（同一の集合ではない。docs/ARCHITECTURE.md 参照）
        createdAfter: new Date(window.end.getTime() - MARKET_WINDOW_DAYS * DAY_MS),
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
    // null は404（リポジトリ消滅・private化）。この銘柄はこの日以降ずっと欠測になるので黙らせない。
    // 改名はここに来ない: GitHubは301を返し、fetchが既定でリダイレクトを追うため
    // 新しい full_name で200が返る（＝履歴が旧名・新名の2キーに割れる。表示側で吸収する）
    if (result.value === null) {
      fetchFailed += 1;
      console.error(`[stars] repository not found repo=${repo.owner}/${repo.name}（恒久欠測）`);
      return;
    }
    favorites.push({ fullName: result.value.full_name, stars: result.value.stargazers_count });
  });

  const observations = mergeStarObservations(trending, favorites);
  const date = new Date(`${day}T00:00:00.000Z`);
  let written = 0;
  let writeFailed = 0;
  if (observations.length > 0) {
    try {
      // 先勝ち・1往復。並行実行が重なっても後から来た方が既存行を書き換えない
      const result = await prisma.repoStarSnapshot.createMany({
        data: observations.map(({ fullName, stars }) => ({ fullName, stars, date })),
        skipDuplicates: true,
      });
      written = result.count;
    } catch (error) {
      // 全行が同型（string + int）なので、単独行だけ失敗する事象は実質起きない＝まとめて計上する
      writeFailed = observations.length;
      console.error(
        `[stars] snapshot write failed date=${day} rows=${observations.length}:`,
        error
      );
    }
  }

  // DoD検証用: 採取フェーズが1回のcronで1度だけ走ったことの証跡。
  // 1件も観測できなかった日はバックフィルできない＝恒久欠測なので、info に埋もれさせない
  const summary = `[stars] collected date=${day} observed=${observations.length} written=${written}`;
  if (observations.length === 0) {
    console.error(`${summary}（この日の星数は恒久欠測になる）`);
  } else {
    console.info(summary);
  }

  return {
    date: day,
    observed: observations.length,
    written,
    fetchFailed,
    writeFailed,
    trendingFailed,
  };
}
