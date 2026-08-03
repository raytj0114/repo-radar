import { defineConfig, devices } from '@playwright/test';
import {
  APP_BASE_URL,
  APP_PORT,
  E2E_AUTH_SECRET,
  E2E_DATABASE_URL,
  E2E_GITHUB_ACCOUNT,
  FAILING_RELEASES_NAME,
  MINTED_REPO_PREFIX,
  MISSING_OWNER,
  MOCK_GITHUB_BASE_URL,
  MOCK_GITHUB_PORT,
  RATE_LIMIT_APP_BASE_URL,
  RATE_LIMIT_APP_PORT,
  RATE_LIMITED_OWNER_PREFIX,
  SEARCH_RATE_LIMIT_APP_BASE_URL,
  SEARCH_RATE_LIMIT_APP_PORT,
  SILENT_OWNER_PREFIX,
  SLOW_OWNER_PREFIX,
  SLOW_RESPONSE_MS,
} from './e2e/constants';

/**
 * アプリ起動時に渡す環境変数。3100番と3102番（レート上限検証用）で同一にする。
 * Next.jsは既に `process.env` にある値を `.env.local` で上書きしないため、
 * ここで渡した値はローカルでもCIでも必ず優先される。
 */
const APP_SERVER_ENV = {
  // next start (本番モード) はデフォルトでlocalhostを信頼しないため、
  // Auth.jsがUntrustedHostエラーを返す。Vercel上ではVERCEL=1により自動で信頼されるため
  // この設定はE2E用のローカル起動時のみ必要（アプリコードには手を入れない）
  AUTH_TRUST_HOST: 'true',
  // テスト側がセッションJWTを署名する鍵と一致させる（e2e/fixtures.ts）
  AUTH_SECRET: E2E_AUTH_SECRET,
  GITHUB_API_BASE_URL: MOCK_GITHUB_BASE_URL,
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_URL: E2E_DATABASE_URL,
} as const;

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
        MOCK_GITHUB_FAILING_RELEASES_NAME: FAILING_RELEASES_NAME,
        MOCK_GITHUB_SLOW_OWNER_PREFIX: SLOW_OWNER_PREFIX,
        MOCK_GITHUB_SLOW_MS: String(SLOW_RESPONSE_MS),
        MOCK_GITHUB_RATE_LIMITED_OWNER_PREFIX: RATE_LIMITED_OWNER_PREFIX,
        MOCK_GITHUB_SILENT_OWNER_PREFIX: SILENT_OWNER_PREFIX,
        MOCK_GITHUB_E2E_ACCOUNT_ID: E2E_GITHUB_ACCOUNT.providerAccountId,
        MOCK_GITHUB_E2E_LOGIN: E2E_GITHUB_ACCOUNT.login,
        MOCK_GITHUB_MINTED_PREFIX: MINTED_REPO_PREFIX,
      },
    },
    {
      // build後にNextのData Cache（.next/cache/fetch-cache）を消してから起動する。
      // このキャッシュはビルドを跨いで残り、期限切れ後もstale-while-revalidateで
      // 「前回実行時のモック応答」を一度配ってしまうため、モックデータを変更した直後の
      // E2Eが古い内容で非決定的に落ちる（Issue #42 で実際に発生。片プロファイルだけ旧データを
      // 掴み、もう片方は再検証後の新データで通る、という不一致になる）
      command: `npm run build && node -e "fs.rmSync('.next/cache/fetch-cache',{recursive:true,force:true})" && npm run start -- --port ${APP_PORT}`,
      url: APP_BASE_URL,
      // 既存サーバーを再利用しない。再利用を許すと古い成果物に対してテストが通り、
      // 「壊したのにE2Eが緑」という誤検証が起きる（DoDの「意図的に崩すと落ちる」が担保できない）。
      // ポートが塞がっている場合はPlaywrightが起動エラーで落ちる＝安全側に倒れる
      reuseExistingServer: false,
      timeout: 180_000,
      env: APP_SERVER_ENV,
    },
    {
      // レート上限の縮退表示専用のインスタンス（Issue #23）。レート残量はアプリの
      // プロセス内モジュール状態で、フロア未満を一度観測すると以降そのプールの呼び出しが
      // fetchの手前で遮断される（＝リクエストが飛ばないので残量は二度と更新されず回復しない）。
      // プロセスを分けることで、実行順やworkerの割り当てに関係なく3100番のテストを巻き込まない。
      // webServerは配列順に起動されるため、直前のエントリのビルド完了後に立ち上がる（追加ビルドは無い）
      command: `npm run start -- --port ${RATE_LIMIT_APP_PORT}`,
      url: RATE_LIMIT_APP_BASE_URL,
      reuseExistingServer: false,
      env: APP_SERVER_ENV,
    },
    {
      // searchプールの縮退表示専用のインスタンス（Issue #42。購読面の検索欄）。
      // 3102番と分けるのは、3102番の紙面テストが「coreが枯れても相場（searchプール）は生きる」
      // というプール分離をアサートしており、searchを枯らすテストと同居できないため
      command: `npm run start -- --port ${SEARCH_RATE_LIMIT_APP_PORT}`,
      url: SEARCH_RATE_LIMIT_APP_BASE_URL,
      reuseExistingServer: false,
      env: APP_SERVER_ENV,
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
