import { expect, test, watchConsoleErrors } from './fixtures';

// 深夜放送（Issue #32）のスモーク。**音は検証しない**。
// headless Chromiumは日本語音声を持たないため、電源を入れても声は出ない。
// それは欠陥ではなく「音声一覧が空の環境」そのもので、このテストは
// そういう端末でも受信機が壊れないことの検証を兼ねる（受け入れ条件のフォールバック）。

test.describe('深夜放送（/radio）', () => {
  test('受信機が組まれ、原稿は画面に出ない', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/radio');

    // 電源は切れた状態で始まる（自動再生の許しは、いちど触れてもらってから得る）
    await expect(page.getByRole('button', { name: '電源' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.getByRole('slider', { name: '同調' })).toBeVisible();

    // 局はダイヤル盤に刷ってある（原稿の到着を待たない筐体の一部）
    await expect(page.getByText('第一放送')).toBeVisible();
    await expect(page.getByText('気象通報')).toBeVisible();
    await expect(page.getByText('深夜便')).toBeVisible();

    // 放送は音にしか存在しない。原稿は決して画面に出さない（回帰防止）
    await expect(page.getByText('定時放送を、お送りします')).toHaveCount(0);
    await expect(page.getByText('沈黙の観測')).toHaveCount(0);
    await expect(page.getByText('こちらは、レポレーダー放送です')).toHaveCount(0);

    assertNoConsoleErrors();
  });

  test('電源を入れて同調すると、受信機が灯り局名が出る', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/radio');

    const power = page.getByRole('button', { name: '電源' });
    const tuner = page.getByRole('slider', { name: '同調' });

    // 電源が切れているあいだツマミは死んでいる
    await expect(tuner).toHaveAttribute('aria-disabled', 'true');

    await power.click();
    await expect(power).toHaveAttribute('aria-pressed', 'true');
    await expect(tuner).toHaveAttribute('aria-disabled', 'false');

    // 帯の下端へ振り切ってから、自動選局で最初の局（79.5MHz）へ寄せる
    await tuner.press('Home');
    await expect(tuner).toHaveAttribute('aria-valuenow', '76');
    await tuner.press('ArrowUp');
    await expect(tuner).toHaveAttribute('aria-valuenow', '79.5');
    await expect(tuner).toHaveAttribute('aria-valuetext', /レポレーダー第一/);

    // ニキシー窓は同調した局の名を灯す
    await expect(page.getByText('レポレーダー第一', { exact: true })).toBeVisible();
    // 受信状態は読み上げ環境へも伝える（伝えるのは局名だけで、原稿は入れない）
    await expect(page.getByRole('status')).toHaveText('受信中 レポレーダー第一');
    // 同調しても原稿は出ない
    await expect(page.getByText('定時放送を、お送りします')).toHaveCount(0);

    // 局から離れれば周波数表示に戻り、受信中の告知も消える
    await tuner.press('End');
    await expect(page.getByText('95.0', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('');

    assertNoConsoleErrors();
  });
});
