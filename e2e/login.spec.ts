import { anonTest, expect } from './fixtures';

// 認証必須画面のスモークは e2e/authed.spec.ts（Issue #16 で追加）。
// ここはセッションが無い状態が前提なので anonTest を使う。
anonTest.describe('/login', () => {
  anonTest('GitHubでログインボタンが表示される', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: '日刊 RepoRadar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeVisible();
  });
});
