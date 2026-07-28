import { GitHubRateLimitError } from '@/lib/github/client';

// 互いに独立した取得を同時に投げるためのヘルパ（Issue #6）。
// 直列に await すると待ち時間が単純に加算されるため、依存関係の無い取得は Promise.all でまとめる。
//
// 失敗の扱いは呼び出し側の分岐に依存する（例: リポジトリが404なら releases の結果は成功・失敗とも
// 捨てる）。そのため結果は PromiseSettledResult のまま受け取り、実際に使う時点で unwrapSettled する。

/** レート上限で取得できなかったことを表す番兵。「対象なし（404）」を意味する null と区別する */
export const RATE_LIMITED = Symbol('github-rate-limited');

export type RateLimited = typeof RATE_LIMITED;

/**
 * 失敗も値として受け取れる形に包む。`Promise.all` の要素にしても他の取得を巻き込んで落とさない。
 * `Promise.allSettled` と違い、1件ずつ包めるので他の型の処理（Prismaクエリ等）と並べられる。
 */
export function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): PromiseSettledResult<T> => ({ status: 'rejected', reason })
  );
}

/**
 * 並列取得の結果を取り出す。レート上限だけは縮退表示のための番兵に変換し、
 * それ以外の失敗は元の例外のまま投げ直す（エラーを握りつぶさない）。
 */
export function unwrapSettled<T>(settled: PromiseSettledResult<T>): T | RateLimited {
  if (settled.status === 'fulfilled') {
    return settled.value;
  }
  if (settled.reason instanceof GitHubRateLimitError) {
    return RATE_LIMITED;
  }
  throw settled.reason;
}
