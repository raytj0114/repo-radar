import type { Page } from '@playwright/test';
import { expect, test, watchConsoleErrors } from './fixtures';
import {
  E2E_FAVORITES,
  RATE_LIMIT_APP_BASE_URL,
  RATE_LIMITED_OWNER_PREFIX,
  SEARCH_RATE_LIMIT_APP_BASE_URL,
} from './constants';

const PRIMARY_FULL_NAME = `${E2E_FAVORITES[0].owner}/${E2E_FAVORITES[0].name}`;

// レート上限（GitHub API 残量フロア未満）の縮退表示のE2E（Issue #23）。
//
// 仕組み: モックサーバーは owner が `RATE_LIMITED_OWNER_PREFIX` で始まるリクエストに対し、
// 応答は正常系のまま `x-ratelimit-remaining: 0` を返す。アプリは残量を「次の呼び出しの手前」で
// 見るため、この応答を踏んだ時点ではまだ成功し、以降のcore呼び出しが遮断される。
// つまり縮退表示の検証には「残量を観測させる1回目」と「遮断される2回目」の2アクセスが必要。
//
// 検証対象は3100番ではなく専用インスタンス（`RATE_LIMIT_APP_BASE_URL`）。残量はアプリの
// プロセス内モジュール状態で、遮断はfetchの手前で起きる＝以降リクエストが飛ばないため
// 高残量を踏ませても回復できない。プロセスを分けることで、実行順やworkerの割り当てに
// 関係なく他のテストを巻き込まない（＝このファイル内のテストも互いに順序非依存）。
//
// 認証Cookieは fixtures.ts が localhost に対して注入する。Cookieはポートを区別しないため、
// 3100番向けに作ったセッションがこのインスタンスにもそのまま効く。

/**
 * 1リクエスト分の残量観測を踏ませ、対象インスタンスのcoreプールを遮断状態にする。
 * ownerは実行ごとに一意にする（Nextのfetchキャッシュに当たるとリクエスト自体が発生せず、
 * 残量ヘッダを観測できないため）。owner名は39文字以内に収める（`src/lib/favorite-input.ts`）。
 * 既に遮断済みなら1回目から縮退表示になるが、どちらでも後続の検証は成立する。
 */
async function exhaustCoreRateLimit(page: Page, projectName: string): Promise<string> {
  const owner = `${RATE_LIMITED_OWNER_PREFIX}-${projectName}-${Date.now()}`;
  await page.goto(`${RATE_LIMIT_APP_BASE_URL}/repos/${owner}/probe`);
  return owner;
}

test.describe('レート上限の縮退表示', () => {
  test('リポジトリ詳細は取得できなかった旨のNoticeに縮退する', async ({ page }, testInfo) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    const owner = await exhaustCoreRateLimit(page, testInfo.project.name);

    // 1回目とは別のURLへ移動する（ブラウザキャッシュの影響を受けずに再レンダーさせるため）
    await page.goto(`${RATE_LIMIT_APP_BASE_URL}/repos/${owner}/degraded`);

    await expect(
      page.getByText('レート上限に達したため、リポジトリ情報を取得できませんでした')
    ).toBeVisible();
    // 番兵（RATE_LIMITED）がそのまま描画へ流れていない＝分岐が生きていることの裏取り
    await expect(page.getByRole('heading', { name: `${owner}/degraded` })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'リリース履歴' })).toHaveCount(0);

    assertNoConsoleErrors();
  });

  test('紙面はシェルを保ったまま短信が観測休止になり、相場と天気は生きる', async ({
    page,
  }, testInfo) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await exhaustCoreRateLimit(page, testInfo.project.name);

    await page.goto(`${RATE_LIMIT_APP_BASE_URL}/`);

    // 紙面は落ちない: 題字・日付行のシェルは平常どおり組まれる
    await expect(page.getByRole('heading', { name: '日刊 RepoRadar', level: 1 })).toBeVisible();
    // coreプールの遮断 → 短信・沈黙は観測休止の帯に縮退する
    await expect(page.getByText('レート上限につき観測休止中').first()).toBeVisible();
    // レート枠はプール別（core/search）: coreが遮断されても相場（search）と
    // 天気（/rate_limit はゲートの外）は生きている。この分離が壊れると両方とも休載になる
    await expect(
      page.getByRole('cell', { name: 'octocat/observability-dashboard-toolkit' })
    ).toBeVisible();
    // 左耳は760px以下で畳まれるため、天気は下段ボックス固有の数字で見る
    await expect(page.getByText('4,999 ／ 5,000')).toBeVisible();
    await expect(page.getByText('データリンク不通につき休載。')).toHaveCount(0);

    assertNoConsoleErrors();
  });

  // 購読面（Issue #42）: 星取帳はcoreプール。枯渇時は観測休止の帯に倒れ、台帳（DB）は生きる
  test('購読面の星取帳は観測休止に縮退し、台帳は生きる', async ({ page }, testInfo) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await exhaustCoreRateLimit(page, testInfo.project.name);

    await page.goto(`${RATE_LIMIT_APP_BASE_URL}/favorites?star=1`);

    // 星取帳は短信と同じ観測休止の帯（STOP_PRESS_TEXT）
    await expect(page.getByText('レート上限につき観測休止中')).toBeVisible();
    // 台帳はDB読みなので枯渇の影響を受けない＝欄単位の縮退
    await expect(page.getByRole('link', { name: PRIMARY_FULL_NAME })).toBeVisible();

    assertNoConsoleErrors();
  });
});

// searchプールの縮退は3103番で検証する。3102番の紙面テストが「coreが枯れても相場（search）は
// 生きる」というプール分離をアサートしており、searchを枯らすテストと同居できないため。
// 枯渇のさせ方はcoreと同じ二段構え: `ratelimited` 始まりの検索語への応答が残量0を報告し（1訪目）、
// 以降のsearch呼び出しがfetchの手前で遮断される（2訪目）。クエリは実行ごとに一意にして
// fetchキャッシュに当たらないようにする。並走プロジェクトが先に枯らしていても、
// 検証するのは最終状態（2訪目の休載）だけなので成立する
test.describe('検索枠（searchプール）の縮退表示', () => {
  test('購読面の検索欄は休載に倒れ、台帳は生きる', async ({ page }, testInfo) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);

    const poison = `${RATE_LIMITED_OWNER_PREFIX}-${testInfo.project.name}-${Date.now()}`;
    // 1訪目: 購読面はブロッキングレンダーなので、応答完了＝残量0の観測完了
    await page.goto(`${SEARCH_RATE_LIMIT_APP_BASE_URL}/favorites?q=${poison}`);

    await page.goto(`${SEARCH_RATE_LIMIT_APP_BASE_URL}/favorites?q=probe-${Date.now()}`);

    // 相場欄（market-table.tsx）と同文の休載
    await expect(page.getByText('検索枠の上限につき本日は休載。')).toBeVisible();
    await expect(page.getByRole('link', { name: PRIMARY_FULL_NAME })).toBeVisible();

    assertNoConsoleErrors();
  });
});
