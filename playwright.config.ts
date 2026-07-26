import { defineConfig, devices } from '@playwright/test';

// dev（3000番）と衝突させないE2E専用ポート。
// 開発サーバーが起動したままでも、E2Eは必ず自前でbuild→startした成果物を検証する
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

// build→startした本番相当サーバーに対してテストする（CLAUDE.md検証ループと同じ成果物を検証対象にするため）。
// 起動には src/lib/env.ts の SKIP_ENV_VALIDATION 経路を通すダミー環境変数が必要
// （ローカルは既存の .env.local、CIは .github/workflows/ci.yml の e2e ジョブで設定）。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CIではgithubアノテーションに加え、失敗調査用にHTMLレポートも生成する（CI側でアーティファクトとしてアップロード）
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    // 既存サーバーを再利用しない。再利用を許すと古い成果物に対してテストが通り、
    // 「壊したのにE2Eが緑」という誤検証が起きる（DoDの「意図的に崩すと落ちる」が担保できない）。
    // ポートが塞がっている場合はPlaywrightが起動エラーで落ちる＝安全側に倒れる
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // next start (本番モード) はデフォルトでlocalhostを信頼しないため、
      // Auth.jsがUntrustedHostエラーを返す。Vercel上ではVERCEL=1により自動で信頼されるため
      // この設定はE2E用のローカル起動時のみ必要（アプリコードには手を入れない）
      AUTH_TRUST_HOST: 'true',
    },
  },
  projects: [
    {
      // iPhone SE相当（375px幅、CLAUDE.md不変条件7に合わせる）。
      // Chromiumのモバイルエミュレーションで代用し、CIで追加のブラウザエンジン（webkit）インストールを不要にする
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
