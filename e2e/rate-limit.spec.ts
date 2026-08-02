import type { Page } from '@playwright/test';
import { expect, test, watchConsoleErrors } from './fixtures';
import { RATE_LIMIT_APP_BASE_URL, RATE_LIMITED_OWNER_PREFIX } from './constants';

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
});
