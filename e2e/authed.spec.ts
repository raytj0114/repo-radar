import { anonTest, expect, test, watchConsoleErrors } from './fixtures';
import { E2E_DIGEST, E2E_FAVORITES, MISSING_OWNER } from './constants';

// 認証必須画面のスモーク（Issue #16）。
// GitHub APIは e2e/mock-github/server.mjs に差し替わっており、DBは e2e/global-setup.ts が
// 決定的にシードしている。外部への実通信が無いことは fixtures.ts のガードが各テストで検証する。

const [PRIMARY_FAVORITE, SECONDARY_FAVORITE] = E2E_FAVORITES;
const PRIMARY_FULL_NAME = `${PRIMARY_FAVORITE.owner}/${PRIMARY_FAVORITE.name}`;
const SECONDARY_FULL_NAME = `${SECONDARY_FAVORITE.owner}/${SECONDARY_FAVORITE.name}`;

/** モックのリリースは3件だがdraftが1件混ざるため、画面に出るのはリポジトリあたり2件 */
const VISIBLE_RELEASES_PER_REPO = 2;

test.describe('ダッシュボード', () => {
  test('お気に入りの最新リリースが新しい順に並ぶ', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible();
    await expect(page.locator('main ol > li')).toHaveCount(
      E2E_FAVORITES.length * VISIBLE_RELEASES_PER_REPO
    );
    await expect(page.getByRole('link', { name: PRIMARY_FULL_NAME }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: SECONDARY_FULL_NAME }).first()).toBeVisible();
    // draftリリースはタイムラインに載せない
    await expect(page.getByText('v17 (draft)')).toHaveCount(0);

    assertNoConsoleErrors();
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
  test('過去のダイジェストと未生成の案内が表示される', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/digest');

    await expect(
      page.getByRole('heading', { name: 'デイリーダイジェスト', level: 1 })
    ).toBeVisible();
    await expect(page.getByText(E2E_DIGEST.content)).toBeVisible();
    // シードは過去日付のみなので、本日分未生成のNoticeが必ず出る
    await expect(page.getByText('本日分のダイジェストはまだ生成されていません')).toBeVisible();

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
});

anonTest.describe('未認証', () => {
  for (const path of [
    '/',
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
