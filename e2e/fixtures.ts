import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { APP_BASE_URL, E2E_AUTH_SECRET, E2E_USER, SESSION_COOKIE_NAME } from './constants';

// E2E共通のテスト拡張とヘルパー。
// - `anonTest`: 未認証。外部通信ガードとホスティング依存アセットのスタブのみ適用する
// - `test`: `anonTest` に認証済みセッションCookieの注入を足したもの

/** 1x1の透明PNG。next/imageの最適化リクエストをブラウザ側で握って返す */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** ローカル扱いするホスト。これ以外へのリクエストは「外部への実通信」として検出する */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * 認証済みセッションのCookie。
 * Auth.jsのJWTをテスト側で署名して注入するだけなので、認証をバイパスする分岐を
 * 本番コードへ追加せずに済む（CLAUDE.md 不変条件1 / Issue #16 論点2）。
 */
async function sessionCookie() {
  const value = await encode({
    // Auth.jsは暗号鍵の導出にCookie名をsaltとして使う。サーバー側と一致させる必要がある
    salt: SESSION_COOKIE_NAME,
    secret: E2E_AUTH_SECRET,
    token: {
      // src/lib/auth.ts のsessionコールバックが session.user.id に詰める値
      id: E2E_USER.id,
      sub: E2E_USER.id,
      name: E2E_USER.name,
      email: E2E_USER.email,
    },
    maxAge: 60 * 60,
  });
  return { name: SESSION_COOKIE_NAME, value, url: APP_BASE_URL, httpOnly: true } as const;
}

/**
 * Vercel上でのみ配信されるアセットと、next/imageが外部から取得する画像をブラウザ側で握る。
 * これを入れないと next/image の最適化がサーバー側でGitHubのアバターを実取得してしまう。
 */
async function stubHostedAssets(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.pathname === '/_next/image',
    (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  );
  // Analytics / Speed Insights のスクリプトはVercel上にしか存在せず、ローカルでは404になる
  await context.route(
    (url) => url.pathname.startsWith('/_vercel/'),
    (route) => route.fulfill({ status: 204, body: '' })
  );
}

/** 外部オリジンへのリクエストを記録し、テスト終了時に0件であることを検証する */
function watchExternalRequests(context: BrowserContext): () => void {
  const external: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (LOCAL_HOSTNAMES.has(url.hostname)) return;
    external.push(request.url());
  });
  return () => {
    expect(external, `外部オリジンへのリクエストが発生した:\n${external.join('\n')}`).toEqual([]);
  };
}

/** 未認証のテスト。/login のように「セッションが無いこと」が前提の画面で使う */
export const anonTest = base.extend({
  context: async ({ context }, use) => {
    await stubHostedAssets(context);
    const assertNoExternalRequests = watchExternalRequests(context);
    await use(context);
    assertNoExternalRequests();
  },
});

/** 認証済みのテスト。認証必須画面はこちらを使う */
export const test = anonTest.extend({
  context: async ({ context }, use) => {
    await context.addCookies([await sessionCookie()]);
    await use(context);
  },
});

/** コンソールエラー（および未捕捉例外）を記録し、0件であることを検証するクロージャを返す */
export function watchConsoleErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return () => {
    expect(errors, `コンソールエラーが発生した:\n${errors.join('\n')}`).toEqual([]);
  };
}

/** 横スクロールが発生していないことを検証する（CLAUDE.md 不変条件7） */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  // Reactのストリーミングでは、遅れて届いたコンテンツが一旦hiddenなコンテナへ挿入され、
  // 後から本来の位置へ移動する。移動前は要素の矩形が0になるため、goto直後に測ると
  // 溢れているページでも scrollWidth === clientWidth になり見逃す（実測で確認済み）。
  // `main` が可視になった時点＝コンテンツが本来の位置に置かれた時点で測る。
  // loading.tsx のフォールバックは main を持たないため、これはスケルトンにはマッチしない
  await expect(page.locator('main')).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    // 溢れた要素がhtml/bodyどちらのスクロール幅に現れるかはCSS次第なので両方を見る
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    // 縦スクロールバー分を除いた実際の表示幅
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    scrollWidth,
    `横スクロールが発生している（scrollWidth=${scrollWidth} > clientWidth=${clientWidth}）`
  ).toBeLessThanOrEqual(clientWidth);
}

export { expect };
