// E2E用のGitHub REST APIモックサーバー。
//
// 認証必須画面のデータ取得はServer Component / Server Actionからのサーバー側fetchなので、
// Playwrightの page.route() では捕まえられない。そのためアプリの GITHUB_API_BASE_URL を
// このサーバーへ向け、E2E中はGitHubへの実通信を一切発生させない（Issue #16 論点1）。
//
// 起動は playwright.config.ts の webServer から。設定値は環境変数で受け取り、
// テスト側の期待値（e2e/constants.ts）と二重管理にならないようにする。

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');

const readData = (file) => JSON.parse(readFileSync(join(dataDir, file), 'utf8'));

const repositoryTemplate = readData('repository.json');
const releasesTemplate = readData('releases.json');
const searchResult = readData('search-repositories.json');

const port = Number(process.env.MOCK_GITHUB_PORT);
/** このownerへのリクエストは404を返す（リポジトリ詳細の「見つかりません」経路の検証用） */
const missingOwner = process.env.MOCK_GITHUB_MISSING_OWNER;
/** `missingOwner` 配下でリリース取得だけ500を返すリポジトリ名（404時に失敗を捨てているかの検証用） */
const failingReleasesName = process.env.MOCK_GITHUB_FAILING_RELEASES_NAME;
/** このプレフィックスで始まるownerへのリクエストは遅延させ、時刻を記録する（並列取得の検証用） */
const slowOwnerPrefix = process.env.MOCK_GITHUB_SLOW_OWNER_PREFIX;
const slowMs = Number(process.env.MOCK_GITHUB_SLOW_MS);

if (
  !Number.isInteger(port) ||
  !missingOwner ||
  !failingReleasesName ||
  !slowOwnerPrefix ||
  !Number.isInteger(slowMs)
) {
  throw new Error(
    'MOCK_GITHUB_PORT / MOCK_GITHUB_MISSING_OWNER / MOCK_GITHUB_FAILING_RELEASES_NAME / MOCK_GITHUB_SLOW_OWNER_PREFIX / MOCK_GITHUB_SLOW_MS を指定してください'
  );
}

/**
 * 遅延対象リクエストの `{ path, startedAt, endedAt }`。
 * 遅延対象だけを記録するので、他のテストのリクエストで膨らんだり混ざったりしない。
 */
const requestLog = [];

/** 実APIと同じくレート残量ヘッダを返す。E2Eではフロアに引っかからない十分な残量を報告する */
function send(res, status, body, { resource = 'core' } = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-ratelimit-remaining': resource === 'search' ? '29' : '4999',
    'x-ratelimit-resource': resource,
  });
  res.end(payload);
}

const notFound = (res) => send(res, 404, { message: 'Not Found' });

/** URLのowner/nameでテンプレートを差し替える。どのリポジトリを見に行っても整合した応答になる */
function repositoryFor(owner, name) {
  return {
    ...repositoryTemplate,
    name,
    full_name: `${owner}/${name}`,
    owner: { ...repositoryTemplate.owner, login: owner },
    html_url: `https://github.com/${owner}/${name}`,
  };
}

function releasesFor(owner, name) {
  return releasesTemplate.map((release) => ({
    ...release,
    html_url: `https://github.com/${owner}/${name}/releases/tag/${release.tag_name}`,
  }));
}

/** `q` の `language:` 修飾子だけ解釈する。言語フィルタのE2Eを意味のあるものにするため */
function searchFor(query) {
  const language = /(?:^|\s)language:(\S+)/.exec(query ?? '')?.[1];
  const items = language
    ? searchResult.items.filter((item) => item.language === language)
    : searchResult.items;
  return { ...searchResult, total_count: items.length, items };
}

/** `/repos/:owner/...` のownerが遅延対象か */
function slowOwnerOf(segments) {
  return segments[0] === 'repos' && segments[1]?.startsWith(slowOwnerPrefix) ? segments[1] : null;
}

function handle(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean);

  // webServerの起動待ち用。Playwrightは2xx/3xx/4xxの一部しか「起動済み」とみなさない
  if (url.pathname === '/healthz') {
    send(res, 200, { ok: true });
    return;
  }

  // 遅延対象リクエストの記録。`?owner=` で自テストのぶんだけを取り出す
  if (url.pathname === '/__requests') {
    const owner = url.searchParams.get('owner');
    const prefix = owner ? `/repos/${owner}/` : '/repos/';
    send(
      res,
      200,
      requestLog.filter((entry) => entry.path.startsWith(prefix))
    );
    return;
  }

  if (segments[0] === 'search' && segments[1] === 'repositories') {
    send(res, 200, searchFor(url.searchParams.get('q')), { resource: 'search' });
    return;
  }

  if (segments[0] === 'repos' && segments.length >= 3) {
    const [, owner, name, ...rest] = segments;
    if (owner === missingOwner) {
      // リポジトリは404だがリリース取得だけが失敗する組み合わせ。
      // 並列化後は404でもリリース取得が走るため、その失敗を捨てられているかの検証に使う
      if (name === failingReleasesName && rest[0] === 'releases') {
        send(res, 500, { message: 'Internal Server Error' });
        return;
      }
      notFound(res);
      return;
    }
    // GET /repos/:owner/:name
    if (rest.length === 0) {
      send(res, 200, repositoryFor(owner, name));
      return;
    }
    // GET /repos/:owner/:name/releases （Linkヘッダを返さない＝1ページで打ち止め）
    if (rest.length === 1 && rest[0] === 'releases') {
      send(res, 200, releasesFor(owner, name));
      return;
    }
    // GET /repos/:owner/:name/releases/tags/:tag
    if (rest.length === 3 && rest[0] === 'releases' && rest[1] === 'tags') {
      const tagName = decodeURIComponent(rest[2]);
      const release = releasesFor(owner, name).find((r) => r.tag_name === tagName);
      if (!release) {
        notFound(res);
        return;
      }
      send(res, 200, release);
      return;
    }
  }

  notFound(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const segments = url.pathname.split('/').filter(Boolean);

  if (slowOwnerOf(segments) === null) {
    handle(req, res, url);
    return;
  }

  // 遅延対象: 応答を遅らせ、開始と終了（フラッシュ完了）の時刻を残す。
  // 直列なら「2本目の開始 > 1本目の終了」、並列なら重なる
  const entry = { path: url.pathname, startedAt: Date.now(), endedAt: null };
  requestLog.push(entry);
  res.on('finish', () => {
    entry.endedAt = Date.now();
  });
  setTimeout(() => handle(req, res, url), slowMs);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-github] listening on http://127.0.0.1:${port}`);
});
