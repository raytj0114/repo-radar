import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import repositoryFixture from './fixtures/github/repository.json';
import releasesFixture from './fixtures/github/releases.json';
import searchFixture from './fixtures/github/search-repositories.json';

// 実APIは叩かない。envとglobal fetchをモックする。
// `mock` 始まりの変数はvi.mockのファクトリから参照できる（vitestの巻き上げ規則）
const mockEnv: { GITHUB_API_TOKEN: string; GITHUB_API_BASE_URL?: string } = {
  GITHUB_API_TOKEN: 'test-token',
};

vi.mock('@/lib/env', () => ({ env: mockEnv }));

type FakeResponseInit = {
  status?: number;
  headers?: Record<string, string>;
};

function fakeResponse(body: unknown, { status = 200, headers = {} }: FakeResponseInit = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const fetchMock = vi.fn();

// client.tsはレート残量をモジュール状態で持つため、テストごとに再importする
async function importClient() {
  vi.resetModules();
  return import('@/lib/github/client');
}

beforeEach(() => {
  delete mockEnv.GITHUB_API_BASE_URL;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ベースURL', () => {
  it('GITHUB_API_BASE_URL 未設定なら公開GitHubを叩く', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(repositoryFixture));
    await client.fetchRepository('vercel', 'next.js');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/vercel/next.js');
  });

  it('GITHUB_API_BASE_URL があればそちらを叩く（E2Eのモックサーバー向け）', async () => {
    mockEnv.GITHUB_API_BASE_URL = 'http://127.0.0.1:3101';
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(repositoryFixture));
    await client.fetchRepository('vercel', 'next.js');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3101/repos/vercel/next.js');
  });

  it('末尾のスラッシュは正規化する', async () => {
    mockEnv.GITHUB_API_BASE_URL = 'http://127.0.0.1:3101/';
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(repositoryFixture));
    await client.fetchRepository('vercel', 'next.js');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3101/repos/vercel/next.js');
  });

  it('空文字は未設定として扱う（SKIP_ENV_VALIDATION経路ではzodの既定値が効かないため）', async () => {
    mockEnv.GITHUB_API_BASE_URL = '';
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(repositoryFixture));
    await client.fetchRepository('vercel', 'next.js');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/vercel/next.js');
  });
});

describe('fetchRepository', () => {
  it('200レスポンスをスキーマ検証して返す', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(repositoryFixture));
    const repo = await client.fetchRepository('vercel', 'next.js');
    expect(repo?.full_name).toBe('vercel/next.js');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/vercel/next.js');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.next).toEqual({ revalidate: 3600 });
  });

  it('404は想定内としてnullを返す', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse({ message: 'Not Found' }, { status: 404 }));
    await expect(client.fetchRepository('gone', 'repo')).resolves.toBeNull();
  });

  it('500では上流の本文を含まない汎用メッセージのGitHubAPIErrorを投げる', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(
      fakeResponse({ message: 'internal secret detail' }, { status: 500 })
    );
    const error = await client.fetchRepository('a', 'b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(client.GitHubAPIError);
    expect((error as Error).message).not.toContain('internal secret detail');
  });

  it('レスポンスが想定外の形式ならGitHubAPIError(502)を投げる', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse({ unexpected: true }));
    const error = await client.fetchRepository('a', 'b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(client.GitHubAPIError);
    expect((error as InstanceType<typeof client.GitHubAPIError>).status).toBe(502);
  });
});

describe('レート制限', () => {
  it('残量がフロア(100)未満になったら以降の呼び出しをfetchせずに拒否する', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(
      fakeResponse(repositoryFixture, { headers: { 'x-ratelimit-remaining': '50' } })
    );
    await client.fetchRepository('vercel', 'next.js');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(client.fetchRepository('vercel', 'next.js')).rejects.toBeInstanceOf(
      client.GitHubRateLimitError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('searchプールの残量が少なくてもcoreの呼び出しは遮断しない（プールは別枠）', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValueOnce(
      fakeResponse(searchFixture, {
        headers: { 'x-ratelimit-remaining': '25', 'x-ratelimit-resource': 'search' },
      })
    );
    await client.searchTrendingRepositories({ createdAfter: new Date() });

    fetchMock.mockResolvedValueOnce(
      fakeResponse(repositoryFixture, {
        headers: { 'x-ratelimit-remaining': '4900', 'x-ratelimit-resource': 'core' },
      })
    );
    await expect(client.fetchRepository('vercel', 'next.js')).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('searchプールの残量がフロア(3)未満になったら検索を拒否する', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValueOnce(
      fakeResponse(searchFixture, {
        headers: { 'x-ratelimit-remaining': '2', 'x-ratelimit-resource': 'search' },
      })
    );
    await client.searchTrendingRepositories({ createdAfter: new Date() });

    await expect(
      client.searchTrendingRepositories({ createdAfter: new Date() })
    ).rejects.toBeInstanceOf(client.GitHubRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('残量が十分なら呼び出しを続行する', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(
      fakeResponse(repositoryFixture, { headers: { 'x-ratelimit-remaining': '4900' } })
    );
    await client.fetchRepository('vercel', 'next.js');
    await client.fetchRepository('vercel', 'next.js');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchReleases', () => {
  it('Linkヘッダのrel="next"を辿って全ページを結合し、draftを除外する', async () => {
    const client = await importClient();
    const page2 = [{ ...releasesFixture[0], id: 999, tag_name: 'v16.1.0' }];
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(releasesFixture, {
          headers: {
            link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="last"',
          },
        })
      )
      .mockResolvedValueOnce(fakeResponse(page2));
    const releases = await client.fetchReleases('vercel', 'next.js');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/vercel/next.js/releases?per_page=100'
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.github.com/repositories/1/releases?per_page=100&page=2'
    );
    // fixture3件のうちdraft1件が除外され、page2の1件が加わる
    expect(releases?.map((r) => r.tag_name)).toEqual(['v16.2.0', 'v16.3.0-canary.1', 'v16.1.0']);
  });

  it('rel="next"が続いても上限の3ページで打ち切る', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(
      fakeResponse([releasesFixture[0]], {
        headers: { link: '<https://api.github.com/repos/v/n/releases?page=99>; rel="next"' },
      })
    );
    const releases = await client.fetchReleases('vercel', 'next.js');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(releases).toHaveLength(3);
  });

  it('404は想定内としてnullを返す', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse({ message: 'Not Found' }, { status: 404 }));
    await expect(client.fetchReleases('gone', 'repo')).resolves.toBeNull();
  });

  // ダッシュボードは1リポジトリ数件しか表示しないため、取得量を絞って呼ぶ（Issue #5）
  it('perPage/maxPagesを指定すると取得量を絞る（rel="next"があっても辿らない）', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(
      fakeResponse(releasesFixture, {
        headers: { link: '<https://api.github.com/repos/v/n/releases?page=2>; rel="next"' },
      })
    );
    await client.fetchReleases('vercel', 'next.js', { perPage: 5, maxPages: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/vercel/next.js/releases?per_page=5'
    );
  });

  it('perPageはGitHubの上限100に丸める', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(releasesFixture));
    await client.fetchReleases('vercel', 'next.js', { perPage: 500, maxPages: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/vercel/next.js/releases?per_page=100'
    );
  });

  it('perPage/maxPagesが0以下でも最小値まで持ち上げる（取得なしにはしない）', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(releasesFixture));
    await client.fetchReleases('vercel', 'next.js', { perPage: 0, maxPages: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/vercel/next.js/releases?per_page=1'
    );
  });

  it('既定ではrevalidate付きのfetchキャッシュを使う', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(releasesFixture));
    await client.fetchReleases('vercel', 'next.js', { maxPages: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.next).toEqual({ revalidate: 300 });
    expect(init.cache).toBeUndefined();
  });

  // digest cronは窓終端の取りこぼし防止のためキャッシュを踏まない（Issue #36 指摘3）
  it('fresh指定ではno-storeになり、Data Cacheを共有しない', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(releasesFixture));
    await client.fetchReleases('vercel', 'next.js', { maxPages: 1, fresh: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
  });
});

describe('fetchReleaseByTag', () => {
  it('タグ名をURLエンコードして1件取得する', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(releasesFixture[0]));
    const release = await client.fetchReleaseByTag('vercel', 'next.js', 'v16.2.0+build/1');
    expect(release?.tag_name).toBe('v16.2.0');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/vercel/next.js/releases/tags/v16.2.0%2Bbuild%2F1'
    );
  });

  it('404は想定内としてnullを返す', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse({ message: 'Not Found' }, { status: 404 }));
    await expect(client.fetchReleaseByTag('a', 'b', 'v9.9.9')).resolves.toBeNull();
  });
});

describe('searchTrendingRepositories', () => {
  it('言語と作成日の条件からクエリを組み立て、結果をスキーマ検証して返す', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(searchFixture));
    const result = await client.searchTrendingRepositories({
      language: 'TypeScript',
      createdAfter: new Date(Date.UTC(2026, 5, 25)),
    });
    expect(result.items).toHaveLength(2);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/search/repositories');
    expect(url.searchParams.get('q')).toBe('created:>2026-06-25 language:TypeScript');
    expect(url.searchParams.get('sort')).toBe('stars');
    expect(url.searchParams.get('order')).toBe('desc');
  });

  it('言語未指定ならlanguage修飾子を付けない', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(searchFixture));
    await client.searchTrendingRepositories({ createdAfter: new Date(Date.UTC(2026, 5, 25)) });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('q')).toBe('created:>2026-06-25');
  });

  it('403では混雑を示す汎用メッセージのGitHubAPIErrorを投げる', async () => {
    const client = await importClient();
    fetchMock.mockResolvedValue(
      fakeResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'retry-after': '60' } }
      )
    );
    const error = await client
      .searchTrendingRepositories({ createdAfter: new Date() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(client.GitHubAPIError);
    expect((error as InstanceType<typeof client.GitHubAPIError>).status).toBe(403);
    expect((error as Error).message).not.toContain('API rate limit exceeded');
  });
});
