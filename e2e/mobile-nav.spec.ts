import { expect, test } from './fixtures';

// PR #11 で追加したモバイルナビの保護（Issue #16）。
// 375px幅のプロファイルでのみ意味を持つため、desktopプロファイルとは検証内容を分ける。
// / は全画面紙面でグローバルヘッダーを持たないため（Issue #31）、起点は /trending にする。

test.describe('モバイルナビ（375px）', () => {
  test.skip(({ isMobile }) => !isMobile, 'モバイルプロファイル専用');

  test('開いてナビ項目が見え、Escで閉じてトリガーへフォーカスが戻る', async ({ page }) => {
    await page.goto('/trending');

    const trigger = page.getByRole('button', { name: 'メニューを開く' });
    const panel = page.getByRole('dialog', { name: 'メニュー' });

    await expect(trigger).toBeVisible();
    await expect(panel).toBeHidden();

    await trigger.click();

    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: 'トレンド' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'ログアウト' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'メニューを閉じる' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('メニューのリンクで遷移し、遷移後は閉じている', async ({ page }) => {
    await page.goto('/trending');

    await page.getByRole('button', { name: 'メニューを開く' }).click();
    const panel = page.getByRole('dialog', { name: 'メニュー' });
    await panel.getByRole('link', { name: 'ダイジェスト' }).click();

    await expect(page).toHaveURL(/\/digest$/);
    await expect(
      page.getByRole('heading', { name: 'デイリーダイジェスト', level: 1 })
    ).toBeVisible();
    await expect(panel).toBeHidden();
  });
});

test.describe('デスクトップのナビ', () => {
  test.skip(({ isMobile }) => isMobile, 'デスクトッププロファイル専用');

  test('ハンバーガーは出さず、インラインのナビを表示する', async ({ page }) => {
    await page.goto('/trending');

    await expect(page.getByRole('button', { name: 'メニューを開く' })).toBeHidden();
    await expect(page.getByRole('banner').getByRole('link', { name: 'トレンド' })).toBeVisible();
  });
});

// / は全画面紙面でグローバルヘッダーを持たない（Issue #31）。両プロファイルで検証する
test.describe('紙面（/）のナビ分岐', () => {
  test('ハンバーガーを出さず、紙面の耳ナビで遷移できる', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'メニューを開く' })).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '紙面の耳' })
      .getByRole('link', { name: 'トレンド面' })
      .click();
    await expect(page).toHaveURL(/\/trending$/);
    await expect(page.getByRole('heading', { name: 'トレンド', level: 1 })).toBeVisible();
  });
});
