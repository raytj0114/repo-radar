import { test, expect } from '@playwright/test';

// 認証不要で到達できるページのみが対象（Issue #4 のスコープ）
const PUBLIC_PATHS = ['/login'];

test.describe('横スクロール検知', () => {
  for (const path of PUBLIC_PATHS) {
    test(`${path} で横スクロールが発生しない`, async ({ page }) => {
      await page.goto(path);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});
