// E2Eの固定値。playwright.config.ts / global-setup.ts / fixtures.ts / 各specで共有する。
// ここを唯一の出所にすることで「サーバー側の設定」と「テスト側の期待値」がずれないようにする。

/** アプリ本体。dev（3000番）と衝突させないE2E専用ポート */
export const APP_PORT = 3100;
export const APP_BASE_URL = `http://localhost:${APP_PORT}`;

/** GitHub APIのモックサーバー。サーバー側からのみ参照されるためブラウザは触らない */
export const MOCK_GITHUB_PORT = 3101;
export const MOCK_GITHUB_BASE_URL = `http://127.0.0.1:${MOCK_GITHUB_PORT}`;

/**
 * E2E固定のAuth.js署名鍵。playwright.config.ts の webServer.env でサーバーへ渡し、
 * テスト側は同じ値でセッションJWTを署名する。
 * Next.jsは既にprocess.envにある値を .env.local で上書きしないため、
 * ローカル（.env.localあり）でもCI（ダミー値）でも必ずこの値になる。
 */
export const E2E_AUTH_SECRET = 'e2e-dummy-auth-secret';

/** Auth.js v5 のセッションCookie名。httpsではないため `__Secure-` プレフィックスは付かない */
export const SESSION_COOKIE_NAME = 'authjs.session-token';

/**
 * E2E専用データベース。開発用の `repo_radar` を汚さないよう別DBを使う。
 * ローカルは docker compose の Postgres、CIはサービスコンテナを指す。
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/repo_radar_e2e';

/** 画像はnext/imageの最適化経由になるため、avatarUrlはnullにして外部取得の経路自体を減らす */
export const E2E_USER = {
  id: 'e2e-user',
  name: 'E2Eテストユーザー',
  email: 'e2e@example.com',
} as const;

/**
 * シードするお気に入り。モックサーバーはowner/nameをURLから読んで応答を組み立てるため、
 * ここに何を並べてもリポジトリ詳細・ダッシュボードは成立する。
 * 2件目は「実在しうる長さ」のリポジトリ名で375px幅のtruncateを踏ませる。
 * 10件あるのはダッシュボードのストリーミング（Issue #5 のDoD「お気に入り10件の状態」）を
 * 実サイズで踏むため。1リポジトリ1リクエストなので増やしてもモックへの負荷は線形。
 */
export const E2E_FAVORITES = [
  { owner: 'vercel', name: 'next.js' },
  { owner: 'octocat', name: 'observability-dashboard-toolkit' },
  { owner: 'facebook', name: 'react' },
  { owner: 'microsoft', name: 'typescript' },
  { owner: 'prisma', name: 'prisma' },
  { owner: 'vitest-dev', name: 'vitest' },
  { owner: 'tailwindlabs', name: 'tailwindcss' },
  { owner: 'colinhacks', name: 'zod' },
  { owner: 'pmndrs', name: 'zustand' },
  { owner: 'nextauthjs', name: 'next-auth' },
] as const;

/**
 * シードするダイジェスト。日付を過去に固定することで、
 * 「本日分は未生成」のNoticeが必ず出る決定的な状態を作る。
 */
export const E2E_DIGEST = {
  date: '2026-07-01',
  content:
    'vercel/next.js に v16.2.0 がリリースされ、Turbopackのビルド性能改善とApp Routerのキャッシュ制御の見直しが入りました。octocat/observability-dashboard-toolkit は依存関係の更新のみです。',
} as const;

/** リポジトリ詳細の404経路を踏むためのowner。モックサーバーはこのownerに対して404を返す */
export const MISSING_OWNER = 'missing';

/**
 * 並列取得（Issue #6）の検証用。このプレフィックスで始まるownerへのリクエストに対し、
 * モックサーバーは応答を遅らせたうえで開始/終了時刻を記録し、`/__requests` で返す。
 * 遅延を入れるのは、直列と並列の差を「たまたま速かった」で埋もれさせないため。
 */
export const SLOW_OWNER_PREFIX = 'slow';

/** 遅延させるミリ秒。直列なら2本目の開始が1本目の終了より後になる幅を確保する */
export const SLOW_RESPONSE_MS = 400;
