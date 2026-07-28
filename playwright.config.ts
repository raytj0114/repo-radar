import { defineConfig, devices } from '@playwright/test';
import {
  APP_BASE_URL,
  APP_PORT,
  E2E_AUTH_SECRET,
  E2E_DATABASE_URL,
  MISSING_OWNER,
  MOCK_GITHUB_BASE_URL,
  MOCK_GITHUB_PORT,
  SLOW_OWNER_PREFIX,
  SLOW_RESPONSE_MS,
} from './e2e/constants';

// build→startした本番相当サーバーに対してテストする（CLAUDE.md検証ループと同じ成果物を検証対象にするため）。
// 起動には src/lib/env.ts の SKIP_ENV_VALIDATION 経路を通すダミー環境変数が必要
// （ローカルは既存の .env.local、CIは .github/workflows/ci.yml の e2e ジョブで設定）。
export default defineConfig({
  testDir: './e2e',
  // E2E専用DBのマイグレーションとシード。認証必須画面は全てDBを引くため必須
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CIではgithubアノテーションに加え、失敗調査用にHTMLレポートも生成する（CI側でアーティファクトとしてアップロード）
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      // GitHub APIのモック。アプリのGITHUB_API_BASE_URLをここへ向けて外部通信を断つ
      command: 'node e2e/mock-github/server.mjs',
      url: `${MOCK_GITHUB_BASE_URL}/healthz`,
      reuseExistingServer: false,
      env: {
        MOCK_GITHUB_PORT: String(MOCK_GITHUB_PORT),
        MOCK_GITHUB_MISSING_OWNER: MISSING_OWNER,
        MOCK_GITHUB_SLOW_OWNER_PREFIX: SLOW_OWNER_PREFIX,
        MOCK_GITHUB_SLOW_MS: String(SLOW_RESPONSE_MS),
      },
    },
    {
      command: `npm run build && npm run start -- --port ${APP_PORT}`,
      url: APP_BASE_URL,
      // 既存サーバーを再利用しない。再利用を許すと古い成果物に対してテストが通り、
      // 「壊したのにE2Eが緑」という誤検証が起きる（DoDの「意図的に崩すと落ちる」が担保できない）。
      // ポートが塞がっている場合はPlaywrightが起動エラーで落ちる＝安全側に倒れる
      reuseExistingServer: false,
      timeout: 180_000,
      // Next.jsは既にprocess.envにある値を .env.local で上書きしないため、
      // ここで渡した値はローカルでもCIでも必ず優先される
      env: {
        // next start (本番モード) はデフォルトでlocalhostを信頼しないため、
        // Auth.jsがUntrustedHostエラーを返す。Vercel上ではVERCEL=1により自動で信頼されるため
        // この設定はE2E用のローカル起動時のみ必要（アプリコードには手を入れない）
        AUTH_TRUST_HOST: 'true',
        // テスト側がセッションJWTを署名する鍵と一致させる（e2e/fixtures.ts）
        AUTH_SECRET: E2E_AUTH_SECRET,
        GITHUB_API_BASE_URL: MOCK_GITHUB_BASE_URL,
        DATABASE_URL: E2E_DATABASE_URL,
        DIRECT_URL: E2E_DATABASE_URL,
      },
    },
  ],
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
