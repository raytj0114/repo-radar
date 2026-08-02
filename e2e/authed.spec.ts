import { anonTest, expect, test, watchConsoleErrors } from './fixtures';
import {
  E2E_DIGEST,
  E2E_DIGEST_ENTRIES,
  E2E_FAVORITES,
  E2E_TODAY_DIGEST_ENTRIES,
  FAILING_RELEASES_NAME,
  MISSING_OWNER,
  MOCK_GITHUB_BASE_URL,
  SLOW_OWNER_PREFIX,
} from './constants';

// 認証必須画面のスモーク（Issue #16）。
// GitHub APIは e2e/mock-github/server.mjs に差し替わっており、DBは e2e/global-setup.ts が
// 決定的にシードしている。外部への実通信が無いことは fixtures.ts のガードが各テストで検証する。

const [PRIMARY_FAVORITE] = E2E_FAVORITES;
const PRIMARY_FULL_NAME = `${PRIMARY_FAVORITE.owner}/${PRIMARY_FAVORITE.name}`;

/** モックのリリースは3件だがdraftが1件混ざるため、画面に出るのはリポジトリあたり2件 */
const VISIBLE_RELEASES_PER_REPO = 2;

test.describe('紙面（トップ）', () => {
  test('題字・一面・二番手・短信・沈黙・相場・天気・奥付が組まれる', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/');

    // 題字と日付行（号数・和文日付は純関数のユニットテスト側で担保し、ここでは構造のみ見る）
    await expect(page.getByRole('heading', { name: '日刊 RepoRadar', level: 1 })).toBeVisible();
    await expect(page.getByText('朝刊（六時締）')).toBeVisible();

    // 一面: 当日ダイジェストのシード（E2E_TODAY_DIGEST_ENTRIES）の1件目が
    // 決定則（破壊的変更優先）で選ばれ、headline・lede・【破壊的変更】が組まれる
    const lead = E2E_TODAY_DIGEST_ENTRIES[0];
    await expect(page.getByRole('link', { name: lead.headline })).toBeVisible();
    await expect(page.getByText(lead.lede)).toBeVisible();
    await expect(page.getByText('【破壊的変更】')).toBeVisible();
    // 二番手は別リポジトリの2件目
    await expect(
      page.getByRole('link', { name: E2E_TODAY_DIGEST_ENTRIES[1].headline })
    ).toBeVisible();

    // 短信: 一面・二番手で扱った銘柄（next.js / prisma）は載らず、他の最新信号が並ぶ。
    // モックは相対日付を返すため「着信（十三日前）」相当の行が常に存在する
    await expect(page.getByText('v16.3.0-canary.1 が着信').first()).toBeVisible();
    await expect(
      page.locator('main ul > li').filter({ hasText: `▽${PRIMARY_FAVORITE.name}` })
    ).toHaveCount(0);
    // draftリリースは短信にも載らない（旧タイムアラインからの回帰防止を引き継ぐ）
    await expect(page.getByText('v17.0.0-draft')).toHaveCount(0);

    // 沈黙の記録: silent ownerだけが数年前の日付を返し、一年超の太字（dead行）になる
    const silentRow = page.getByRole('row', { name: /silent-archive\/legacy-parser/ });
    await expect(silentRow).toBeVisible();
    await expect(silentRow.locator('td').first()).toHaveCSS('font-weight', '700');

    // 相場: searchモック由来の銘柄と星数（18420 → ja-JPロケールの桁区切り）
    await expect(page.getByRole('cell', { name: 'octocat/ferris-stream-processor' })).toBeVisible();
    await expect(page.getByText('18,420')).toBeVisible();

    // 天気: /rate_limit モック（4999/5000）→ 晴
    await expect(page.getByText('4,999 ／ 5,000')).toBeVisible();
    await expect(page.getByText('晴', { exact: true })).toBeVisible();

    // 奥付: 紙面内ナビ（ヘッダーの代替）とログアウト
    await expect(page.getByRole('link', { name: '縮刷版（ダイジェスト）' })).toBeVisible();
    // 深夜放送への導線（Issue #32。#41 でラテ欄へ移す）
    await expect(page.getByRole('link', { name: '深夜放送' })).toHaveAttribute('href', '/radio');
    await expect(page.getByRole('button', { name: '退勤（ログアウト）' })).toBeVisible();

    assertNoConsoleErrors();
  });

  // ストリーミングは「初回レスポンスのHTMLに何がどの順で入っているか」で検証する。
  // 描画タイミングを見る方式はモックが速いとすり抜けるため、バイト列の順序で確定的に判定する。
  // スケルトンの目印は aria-label にする（aria-busy は他のフォールバックにもあり区別できない）
  test('シェル（題字）は本文の取得を待たずに先に送出される', async ({ page }) => {
    const html = await (await page.request.get('/')).text();

    const shellIndex = html.indexOf('<h1');
    const skeletonIndex = html.indexOf('組版中');
    const bodyIndex = html.indexOf(E2E_TODAY_DIGEST_ENTRIES[0].headline);

    expect(shellIndex, 'シェル（題字）が初回HTMLに含まれていない').toBeGreaterThanOrEqual(0);
    // 題字（シェル）→ スケルトン（Suspenseフォールバック）→ 後追いの紙面本文、の順に届く
    expect(skeletonIndex, 'Suspenseフォールバックが初回HTMLに含まれていない').toBeGreaterThan(
      shellIndex
    );
    expect(bodyIndex, '紙面本文がシェルより先に届いている').toBeGreaterThan(skeletonIndex);
  });
});

test.describe('トレンド', () => {
  test('スターランキングが表示される', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/trending');

    await expect(page.getByRole('heading', { name: 'トレンド', level: 1 })).toBeVisible();
    await expect(page.locator('main ol > li')).toHaveCount(3);
    // 18420 → 18.4K。モックの数値がサーバー側fetch経由で描画されている証拠になる
    await expect(page.getByText('★ 18.4K')).toBeVisible();

    assertNoConsoleErrors();
  });

  test('言語フィルタで絞り込める', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/trending');

    await page
      .getByRole('navigation', { name: '言語フィルタ' })
      .getByRole('link', { name: 'Rust' })
      .click();

    await expect(page).toHaveURL(/\/trending\?language=Rust$/);
    await expect(page.locator('main ol > li')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'octocat/ferris-stream-processor' })).toBeVisible();

    assertNoConsoleErrors();
  });
});

test.describe('デイリーダイジェスト', () => {
  test('朝刊（entries形式）は総括とリンク付きカードで表示される', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/digest');

    await expect(
      page.getByRole('heading', { name: 'デイリーダイジェスト', level: 1 })
    ).toBeVisible();
    // 冒頭の総括はルールベース生成（シードの3エントリと対応）
    await expect(page.getByText('3リポジトリ・3リリース（うち破壊的変更1件）')).toBeVisible();
    // AIの見出しと破壊的変更バッジ（exact指定で総括内の部分一致と区別する）。
    // 当日の朝刊シード（E2E_TODAY_DIGEST_ENTRIES）にも破壊的変更・同一リポジトリの
    // リンクが含まれるため、first()で厳密モード違反を避ける
    await expect(page.getByText(E2E_DIGEST_ENTRIES.entries[0].headline ?? '')).toBeVisible();
    await expect(page.getByText('破壊的変更', { exact: true }).first()).toBeVisible();
    // カードはリポジトリ詳細へのリンク
    await expect(page.getByRole('link', { name: /vercel\/next\.js/ }).first()).toHaveAttribute(
      'href',
      '/repos/vercel/next.js'
    );
    // 本文なし（noteless）と要約の生成失敗はラベルを分ける（Issue #36 指摘2）
    await expect(page.getByText('リリースノートなし')).toBeVisible();
    await expect(page.getByText('要約を生成できませんでした')).toBeVisible();

    assertNoConsoleErrors();
  });

  test('旧形式（contentのみ）のダイジェストが表示され、未生成の案内は出ない', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/digest');

    await expect(page.getByText(E2E_DIGEST.content)).toBeVisible();
    // 当日分の朝刊をシードしている（紙面の一面検証用）ため、未生成のNoticeは出ない。
    // Notice側の分岐は tests/ のユニットテストで担保する
    await expect(page.getByText('本日分のダイジェストはまだ生成されていません')).toBeHidden();

    assertNoConsoleErrors();
  });
});

test.describe('リポジトリ詳細', () => {
  test('リポジトリ情報とリリース履歴が表示される', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto(`/repos/${PRIMARY_FAVORITE.owner}/${PRIMARY_FAVORITE.name}`);

    await expect(page.getByRole('heading', { name: PRIMARY_FULL_NAME, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'リリース履歴', level: 2 })).toBeVisible();
    await expect(page.locator('main ol > li')).toHaveCount(VISIBLE_RELEASES_PER_REPO);
    await expect(page.getByRole('link', { name: 'v16.2.0', exact: true })).toBeVisible();
    // AI要約はボタン押下でのみ発火する。ここでは押さない＝Geminiへの通信は起きない
    await expect(page.getByRole('button', { name: 'AI要約を表示' })).toBeVisible();

    assertNoConsoleErrors();
  });

  test('存在しないリポジトリでは見つからない旨を表示する', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto(`/repos/${MISSING_OWNER}/unknown-repo`);

    await expect(page.getByText('リポジトリが見つかりません')).toBeVisible();

    assertNoConsoleErrors();
  });

  // 並列化（Issue #6）の回帰防止。直列に戻すと2本目の取得が1本目の応答後に始まるため落ちる。
  // モックサーバー側で応答を SLOW_RESPONSE_MS 遅らせ、リクエストの開始・終了時刻で判定する
  // （画面の表示時間で測る方式はマシンの速度に左右されるため使わない）。
  // Nextのfetchキャッシュに当たると2回目以降リクエストが発生しないので、ownerは実行ごとに変える
  test('リポジトリメタとリリースを同時に取得する', async ({ page, request }, testInfo) => {
    const owner = `${SLOW_OWNER_PREFIX}-${testInfo.project.name}-${Date.now()}`;
    const name = 'parallel-fetch';

    await page.goto(`/repos/${owner}/${name}`);
    await expect(page.getByRole('heading', { name: `${owner}/${name}`, level: 1 })).toBeVisible();

    const log: { path: string; startedAt: number; endedAt: number | null }[] = await (
      await request.get(`${MOCK_GITHUB_BASE_URL}/__requests?owner=${owner}`)
    ).json();
    const repository = log.find((entry) => entry.path === `/repos/${owner}/${name}`);
    const releases = log.find((entry) => entry.path === `/repos/${owner}/${name}/releases`);

    expect(repository, 'リポジトリメタのリクエストが記録されていない').toBeDefined();
    expect(releases, 'リリースのリクエストが記録されていない').toBeDefined();
    // 画面が描画済み＝両方の応答をアプリが受け取った後なので endedAt は必ず埋まっている。
    // 埋まっていないなら記録側の不具合であり、比較の前に切り分けられるようにする
    expect(repository?.endedAt, 'リポジトリメタの応答完了が記録されていない').toEqual(
      expect.any(Number)
    );
    expect(
      releases?.startedAt,
      'リリースの取得がリポジトリメタの応答完了後に始まっている（直列になっている）'
    ).toBeLessThan(repository?.endedAt ?? 0);
  });

  // 並列化により、リポジトリが404でもリリース取得は走ってしまう。その結果（ここでは500）を
  // 捨てられず伝播させると、404表示ではなくエラー画面になる
  test('リポジトリが404ならリリース取得の失敗は捨てて見つからない旨を表示する', async ({
    page,
  }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto(`/repos/${MISSING_OWNER}/${FAILING_RELEASES_NAME}`);

    await expect(page.getByText('リポジトリが見つかりません')).toBeVisible();

    assertNoConsoleErrors();
  });
});

anonTest.describe('未認証', () => {
  for (const path of [
    '/',
    '/radio',
    '/trending',
    '/digest',
    `/repos/${PRIMARY_FAVORITE.owner}/${PRIMARY_FAVORITE.name}`,
  ]) {
    anonTest(`${path} は /login へリダイレクトされる`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeVisible();
    });
  }
});
