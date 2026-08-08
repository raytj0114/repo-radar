import { expect, test } from './fixtures';
import { E2E_FAVORITES } from './constants';

// ナビ規約（Issue #41。旧 mobile-nav.spec.ts の後継）:
// グローバルヘッダーとハンバーガーを廃止し、全面が「上=一面への導線（一面は耳ナビ、
// 内面は題字のwordmark）、下=奥付フルナビ」で回る。分岐が無いため両プロファイルで走らせる。

const [PRIMARY_FAVORITE] = E2E_FAVORITES;

test.describe('紙面ナビ規約', () => {
  test('どの面にもハンバーガーとグローバルヘッダーが無い', async ({ page }) => {
    const paths = [
      '/',
      '/trending',
      '/digest',
      `/repos/${PRIMARY_FAVORITE.owner}/${PRIMARY_FAVORITE.name}`,
      '/favorites',
    ];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'メニューを開く' })).toHaveCount(0);
      // 紙面の題字は main の内側で banner ロールを持たない契約（masthead.tsx）
      await expect(page.getByRole('banner')).toHaveCount(0);
    }
  });

  test('内面の題字（wordmark）から一面へ帰れる', async ({ page }) => {
    await page.goto('/trending');
    await page.getByRole('link', { name: '日刊 RepoRadar' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '日刊 RepoRadar', level: 1 })).toBeVisible();
  });

  test('奥付ナビで面を一巡でき、現在の面はリンクにならない', async ({ page }) => {
    const colophonNav = () => page.getByRole('navigation', { name: '紙面案内' });

    await page.goto('/');
    await colophonNav().getByRole('link', { name: 'トレンド面' }).click();
    await expect(page.getByRole('heading', { name: 'トレンド面', level: 1 })).toBeVisible();

    await colophonNav().getByRole('link', { name: '縮刷版（ダイジェスト）' }).click();
    await expect(page.getByRole('heading', { name: '縮刷版', level: 1 })).toBeVisible();

    await colophonNav().getByRole('link', { name: '購読面' }).click();
    await expect(page.getByRole('heading', { name: '購読面', level: 1 })).toBeVisible();

    await colophonNav().getByRole('link', { name: '一面' }).click();
    await expect(page.getByRole('heading', { name: '日刊 RepoRadar', level: 1 })).toBeVisible();

    // 現在の面（一面）は奥付でリンクにならず、現在地として示される
    await expect(colophonNav().getByRole('link', { name: '一面' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '退勤（ログアウト）' })).toBeVisible();
  });
});
