import { anonTest, expectNoHorizontalOverflow, test } from './fixtures';
import { E2E_FAVORITES } from './constants';

// 認証不要で到達できるページ
const PUBLIC_PATHS = ['/login'];

// 認証必須画面（Issue #16 でカバー範囲を拡張）
const AUTHED_PATHS = [
  '/',
  '/radio',
  '/trending',
  '/trending?language=Rust',
  '/digest',
  `/repos/${E2E_FAVORITES[0].owner}/${E2E_FAVORITES[0].name}`,
  // 購読面（Issue #42）: 台帳のみ / 検索結果表 / 星取帳（長銘柄を含む）の3状態
  '/favorites',
  '/favorites?q=ferris',
  '/favorites?star=1',
];

anonTest.describe('横スクロール検知（未認証ページ）', () => {
  for (const path of PUBLIC_PATHS) {
    anonTest(`${path} で横スクロールが発生しない`, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe('横スクロール検知（認証必須画面）', () => {
  for (const path of AUTHED_PATHS) {
    test(`${path} で横スクロールが発生しない`, async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    });
  }
});
