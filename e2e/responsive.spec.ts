import { test, expect } from '@playwright/test';

// 認証不要で到達できるページのみが対象（Issue #4 のスコープ）
const PUBLIC_PATHS = ['/login'];

test.describe('横スクロール検知', () => {
  for (const path of PUBLIC_PATHS) {
    test(`${path} で横スクロールが発生しない`, async ({ page }) => {
      await page.goto(path);

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
    });
  }
});
