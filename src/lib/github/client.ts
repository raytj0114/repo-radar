import { z } from 'zod';
import { env } from '@/lib/env';
import {
  releaseListSchema,
  repositorySchema,
  searchRepositoriesSchema,
  type Release,
  type Repository,
  type SearchRepositoriesResult,
} from '@/lib/github/schemas';

// GitHub REST APIクライアント（規約は .claude/skills/github-api-patterns/SKILL.md）。
// サーバー側PATで認証する。ユーザーのOAuthトークンは使わない。

const BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const PER_PAGE = 100;

// レート残量がこの値を下回ったら新規呼び出しを止め、明示的なエラーを返す
const RATE_LIMIT_FLOOR = 100;

// ページネーションの上限。リリースは最大3ページ（=300件）まで
const MAX_RELEASE_PAGES = 3;

const REVALIDATE_SECONDS = {
  releases: 300,
  repository: 3600,
  search: 1800,
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

// 直近のレスポンスで観測したレート残量（インスタンス単位のベストエフォート）
let rateLimitRemaining: number | null = null;

function trackRateLimit(res: Response): void {
  const header = res.headers.get('x-ratelimit-remaining');
  if (header === null) return;
  const remaining = Number(header);
  if (Number.isFinite(remaining)) {
    rateLimitRemaining = remaining;
  }
}

async function githubFetch(pathOrUrl: string, revalidate: number): Promise<Response> {
  if (rateLimitRemaining !== null && rateLimitRemaining < RATE_LIMIT_FLOOR) {
    throw new GitHubRateLimitError();
  }
  const url = pathOrUrl.startsWith(`${BASE_URL}/`) ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_API_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'repo-radar',
    },
    next: { revalidate },
  });
  trackRateLimit(res);
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

/**
 * リリース一覧（新しい順、draftは除外）。404は想定内としてnullを返す。
 * per_page=100で最大3ページまで `Link: rel="next"` を辿る。
 */
export async function fetchReleases(owner: string, repo: string): Promise<Release[] | null> {
  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
  const releases: Release[] = [];
  let url: string | null = `${basePath}?per_page=${PER_PAGE}`;
  for (let page = 0; page < MAX_RELEASE_PAGES && url !== null; page++) {
    const res: Response = await githubFetch(url, REVALIDATE_SECONDS.releases);
    if (res.status === 404) return null;
    if (!res.ok) await raiseForStatus(res, `GET ${basePath}`);
    releases.push(...parseWith(releaseListSchema, await res.json(), `GET ${basePath}`));
    url = nextPageUrl(res.headers.get('link'));
  }
  return releases.filter((release) => !release.draft);
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
