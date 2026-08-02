import type { FavoriteRepo } from '@prisma/client';
import { fetchReleases, GitHubRateLimitError } from '@/lib/github/client';
import type { LatestSignal } from '@/lib/paper';

// お気に入り全銘柄の「最新信号」（＝最新リリース）の取得。
// 紙面（/）の短信・沈黙の記録と、深夜放送（/radio）の気象通報が同じ素材を使うため、
// 取得と失敗の切り分けをここに一本化する（Issue #32）。
//
// 取得パラメータを共有することが本質的に重要: `fetchReleases` のURLとrevalidateが
// 一致していればNextのData Cacheに相乗りできる。ずれた瞬間、/ と /radio を続けて開く
// だけでGitHubへの実リクエストが倍になる。

/**
 * 1リポジトリあたりのリリース取得数。最新1件しか使わないが、リポジトリ詳細
 * （既定 per_page=100）ではなく旧ダッシュボードと同じ5件にして、
 * 紙面と深夜放送のあいだでfetchキャッシュを共有する
 */
export const RELEASES_PER_REPO = 5;

export type LatestSignalsResult = {
  /** 最新リリースが1件以上あるお気に入りだけ。`summaryFirstLine` は未解決（null） */
  signals: LatestSignal[];
  /** coreプールのレート上限に当たった（欄ごと縮退表示に倒す合図） */
  rateLimited: boolean;
  /** レート上限以外の理由で取得できなかったリポジトリ数 */
  failedCount: number;
};

type FavoriteRef = Pick<FavoriteRepo, 'owner' | 'name' | 'fullName'>;

/**
 * お気に入りの最新リリースを一斉に取得する（1リポジトリ1リクエスト・並列）。
 * 1件の失敗で全体を落とさず、レート上限だけは呼び出し側が縮退表示に使えるよう区別する。
 * 404（リポジトリの消滅・改名）は黙って除く
 */
export async function loadLatestSignals(
  favorites: readonly FavoriteRef[]
): Promise<LatestSignalsResult> {
  const settled = await Promise.allSettled(
    favorites.map((favorite) =>
      fetchReleases(favorite.owner, favorite.name, { perPage: RELEASES_PER_REPO, maxPages: 1 })
    )
  );

  let rateLimited = false;
  let failedCount = 0;
  const signals: LatestSignal[] = [];
  settled.forEach((result, index) => {
    const favorite = favorites[index];
    if (result.status === 'rejected') {
      if (result.reason instanceof GitHubRateLimitError) {
        rateLimited = true;
      } else {
        failedCount += 1;
        console.error(`[signals] release fetch failed repo=${favorite.fullName}:`, result.reason);
      }
      return;
    }
    const releases = (result.value ?? []).filter((release) => release.published_at !== null);
    if (releases.length === 0) return;
    const latest = releases.reduce((a, b) =>
      Date.parse(a.published_at ?? '') >= Date.parse(b.published_at ?? '') ? a : b
    );
    signals.push({
      owner: favorite.owner,
      name: favorite.name,
      fullName: favorite.fullName,
      tagName: latest.tag_name,
      publishedAt: latest.published_at ?? '',
      summaryFirstLine: null,
    });
  });

  return { signals, rateLimited, failedCount };
}
