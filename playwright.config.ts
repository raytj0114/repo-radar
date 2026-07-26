import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

// build→startした本番相当サーバーに対してテストする（CLAUDE.md検証ループと同じ成果物を検証対象にするため）。
// 起動には src/lib/env.ts の SKIP_ENV_VALIDATION 経路を通すダミー環境変数が必要
// （ローカルは既存の .env.local、CIは .github/workflows/ci.yml の e2e ジョブで設定）。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
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
      // iPhone相当（390px幅）。Chromiumのモバイルエミュレーションで代用し、
      // CIで追加のブラウザエンジン（webkit）インストールを不要にする
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
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
