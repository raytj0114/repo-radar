import { test, expect } from '@playwright/test';

// 認証必須画面（/, /repos, /trending, /digest 等）のE2Eは Issue #4 のスコープ外。
// 対応する場合は次のいずれかを検討する:
//   - NextAuthのJWTセッションCookieをテスト側で生成してモックする
//   - E2E専用のGitHubテストアカウントで実際にOAuthログインする
test.describe('/login', () => {
  test('GitHubでログインボタンが表示される', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'RepoRadar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeVisible();
  });
});
