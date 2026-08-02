import { z } from 'zod';
import { env } from '@/lib/env';
import {
  rateLimitSchema,
  releaseListSchema,
  releaseSchema,
  repositorySchema,
  searchRepositoriesSchema,
  type RateLimitSnapshot,
  type Release,
  type Repository,
  type SearchRepositoriesResult,
} from '@/lib/github/schemas';

// GitHub REST APIクライアント（規約は .claude/skills/github-api-patterns/SKILL.md）。
// サーバー側PATで認証する。ユーザーのOAuthトークンは使わない。

const DEFAULT_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';

// レート残量がこの値を下回ったら新規呼び出しを止め、明示的なエラーを返す。
// GitHubのレート枠はリソース別（core: 5,000/h、search: 30/min）なので、
// フロアも必ずリソース別に判定する（グローバルに判定すると検索1回でcoreまで遮断される）
const RATE_LIMIT_FLOORS = {
  core: 100,
  search: 3,
} as const;

type RateLimitResource = keyof typeof RATE_LIMIT_FLOORS;

/**
 * リリース一覧の取得量の既定値。リポジトリ詳細は履歴を全件見せるため最大3ページ（=300件）辿る。
 * 数件しか表示しない画面（ダッシュボード）は呼び出し側で `perPage` / `maxPages` を絞る。
 */
const RELEASE_FETCH_DEFAULTS = { perPage: 100, maxPages: 3 } as const;

/** `per_page` のGitHub側上限 */
const MAX_PER_PAGE = 100;

const REVALIDATE_SECONDS = {
  releases: 300,
  repository: 3600,
  search: 1800,
  rateLimit: 60,
} as const;

export class GitHubAPIError extends Error {
  constructor(
    readonly status: number,
    safeMessage: string
  ) {
    super(safeMessage);
    this.name = 'GitHubAPIError';
  }
}

export class GitHubRateLimitError extends GitHubAPIError {
  constructor() {
    super(429, 'GitHub APIのレート上限に達したため、しばらく新しいデータを取得できません');
    this.name = 'GitHubRateLimitError';
  }
}

// 直近のレスポンスで観測したリソース別レート残量（インスタンス単位のベストエフォート）
const rateLimitRemaining = new Map<RateLimitResource, number>();

function resourceForUrl(url: string): RateLimitResource {
  return new URL(url).pathname.startsWith('/search/') ? 'search' : 'core';
}

/**
 * リクエスト先のベースURL。既定は公開GitHubで、`GITHUB_API_BASE_URL` で差し替えられる
 * （E2Eのモックサーバー / GitHub Enterprise 向け）。
 * SKIP_ENV_VALIDATION経路ではzodの既定値が効かないため、空文字も未設定として扱う。
 */
function resolveBaseUrl(): string {
  return (env.GITHUB_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function trackRateLimit(res: Response, fallbackResource: RateLimitResource): void {
  const header = res.headers.get('x-ratelimit-remaining');
  if (header === null) return;
  const remaining = Number(header);
  if (!Number.isFinite(remaining)) return;
  // レスポンスが属するプールは x-ratelimit-resource が正。無ければURLから推定
  const reported = res.headers.get('x-ratelimit-resource');
  const resource: RateLimitResource =
    reported !== null && reported in RATE_LIMIT_FLOORS
      ? (reported as RateLimitResource)
      : fallbackResource;
  rateLimitRemaining.set(resource, remaining);
}

/**
 * `revalidate` は秒数、または `'no-store'`（Data Cacheを完全にバイパス）。
 * `'no-store'` はdigest cronの窓判定のように「数分の鮮度差が恒久的な取りこぼしになる」経路専用
 */
async function githubFetch(pathOrUrl: string, revalidate: number | 'no-store'): Promise<Response> {
  const baseUrl = resolveBaseUrl();
  const url = pathOrUrl.startsWith(`${baseUrl}/`) ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
  const resource = resourceForUrl(url);
  const remaining = rateLimitRemaining.get(resource);
  if (remaining !== undefined && remaining < RATE_LIMIT_FLOORS[resource]) {
    throw new GitHubRateLimitError();
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_API_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'repo-radar',
    },
    ...(revalidate === 'no-store' ? { cache: 'no-store' as const } : { next: { revalidate } }),
  });
  trackRateLimit(res, resource);
  return res;
}

/** 上流のエラー本文はクライアントへ透過せず、汎用メッセージに丸める（詳細はサーバーログのみ） */
async function raiseForStatus(res: Response, context: string): Promise<never> {
  const body = await res.text().catch(() => '');
  console.error(`[github] ${context} failed: status=${res.status} body=${body.slice(0, 500)}`);
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter !== null) {
      console.error(`[github] ${context} retry-after=${retryAfter}s`);
    }
    throw new GitHubAPIError(
      res.status,
      'GitHub APIが混み合っています。しばらく待って再試行してください'
    );
  }
  throw new GitHubAPIError(res.status, 'GitHubからのデータ取得に失敗しました');
}

function parseWith<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(
      `[github] ${context}: unexpected response shape`,
      parsed.error.issues.slice(0, 5)
    );
    throw new GitHubAPIError(502, 'GitHubのレスポンスが想定外の形式でした');
  }
  return parsed.data;
}

/** `Link` ヘッダから rel="next" のURLを取り出す */
function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    if (part.includes('rel="next"')) {
      const start = part.indexOf('<');
      const end = part.indexOf('>');
      if (start !== -1 && end > start) {
        return part.slice(start + 1, end);
      }
    }
  }
  return null;
}

/** リポジトリ詳細。404（消滅・改名・private化）は想定内としてnullを返す */
export async function fetchRepository(owner: string, repo: string): Promise<Repository | null> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await githubFetch(path, REVALIDATE_SECONDS.repository);
  if (res.status === 404) return null;
  if (!res.ok) await raiseForStatus(res, `GET ${path}`);
  return parseWith(repositorySchema, await res.json(), `GET ${path}`);
}

/** 取得量の指定。呼び出し側（サーバー）の定数のみで決める。クライアント入力は渡さない */
export type ReleaseFetchOptions = {
  /** 1ページあたりの取得件数。GitHubの上限100に丸める */
  perPage?: number;
  /** 辿る最大ページ数。用途ごとに必ず上限を持つ（規約: 無限に辿らない） */
  maxPages?: number;
  /**
   * Data Cacheをバイパスして常に最新を取る。詳細画面とURLを共有するdigest cronが、
   * 直前に温まったキャッシュ（最大revalidate秒前のスナップショット）で窓終端のリリースを
   * 取りこぼさないための指定（Issue #36 指摘3）。画面系の経路では使わない
   */
  fresh?: boolean;
};

/**
 * リリース一覧（新しい順、draftは除外）。404は想定内としてnullを返す。
 * 既定は per_page=100 で最大3ページまで `Link: rel="next"` を辿る。
 */
export async function fetchReleases(
  owner: string,
  repo: string,
  options: ReleaseFetchOptions = {}
): Promise<Release[] | null> {
  // 呼び出し元はサーバー側の定数だが、上限・下限は関数側で閉じておく
  const perPage = Math.max(
    1,
    Math.min(options.perPage ?? RELEASE_FETCH_DEFAULTS.perPage, MAX_PER_PAGE)
  );
  const maxPages = Math.max(1, options.maxPages ?? RELEASE_FETCH_DEFAULTS.maxPages);
  const revalidate = options.fresh ? ('no-store' as const) : REVALIDATE_SECONDS.releases;
  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
  const releases: Release[] = [];
  let url: string | null = `${basePath}?per_page=${perPage}`;
  for (let page = 0; page < maxPages && url !== null; page++) {
    const res: Response = await githubFetch(url, revalidate);
    if (res.status === 404) return null;
    if (!res.ok) await raiseForStatus(res, `GET ${basePath}`);
    releases.push(...parseWith(releaseListSchema, await res.json(), `GET ${basePath}`));
    url = nextPageUrl(res.headers.get('link'));
  }
  return releases.filter((release) => !release.draft);
}

/** タグ名指定でリリースを1件取得。404（タグ消滅・リポジトリ消滅）は想定内としてnullを返す */
export async function fetchReleaseByTag(
  owner: string,
  repo: string,
  tagName: string
): Promise<Release | null> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tagName)}`;
  const res = await githubFetch(path, REVALIDATE_SECONDS.releases);
  if (res.status === 404) return null;
  if (!res.ok) await raiseForStatus(res, `GET ${path}`);
  return parseWith(releaseSchema, await res.json(), `GET ${path}`);
}

/**
 * レート残量の観測（紙面の天気欄。Issue #31）。`GET /rate_limit` はレート枠を消費しない。
 *
 * `githubFetch` を意図的に通さない:
 * - フロア遮断ゲートの内側だと「残量を報じる関数が残量枯渇で死ぬ」矛盾になる
 *   （残量が尽きたときこそ天気欄は「雨」を報じるべき）
 * - レスポンスヘッダを `trackRateLimit` に流すと、遮断済みインスタンスの残量観測を
 *   健全な値で上書きして遮断を解除してしまう（縮退表示のE2Eが壊れる）。
 *   残量の正はレスポンスボディのみから読む
 */
export async function fetchRateLimit(): Promise<RateLimitSnapshot> {
  const url = `${resolveBaseUrl()}/rate_limit`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_API_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'repo-radar',
    },
    next: { revalidate: REVALIDATE_SECONDS.rateLimit },
  });
  if (!res.ok) await raiseForStatus(res, 'GET /rate_limit');
  return parseWith(rateLimitSchema, await res.json(), 'GET /rate_limit').resources.core;
}

/**
 * トレンド検索: 指定期間以降に作成されたリポジトリをスター数順に返す。
 * 言語未指定なら全言語横断。
 */
export async function searchTrendingRepositories(options: {
  language?: string;
  createdAfter: Date;
  perPage?: number;
}): Promise<SearchRepositoriesResult> {
  const { language, createdAfter, perPage = 30 } = options;
  const qualifiers = [`created:>${createdAfter.toISOString().slice(0, 10)}`];
  if (language) {
    qualifiers.push(`language:${language}`);
  }
  const params = new URLSearchParams({
    q: qualifiers.join(' '),
    sort: 'stars',
    order: 'desc',
    per_page: String(perPage),
  });
  const path = `/search/repositories?${params.toString()}`;
  const res = await githubFetch(path, REVALIDATE_SECONDS.search);
  if (!res.ok) await raiseForStatus(res, 'GET /search/repositories');
  return parseWith(searchRepositoriesSchema, await res.json(), 'GET /search/repositories');
}
