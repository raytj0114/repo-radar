// E2Eの固定値。playwright.config.ts / global-setup.ts / fixtures.ts / 各specで共有する。
// ここを唯一の出所にすることで「サーバー側の設定」と「テスト側の期待値」がずれないようにする。

import { digestWindowFor } from '@/lib/digest-window';

/** アプリ本体。dev（3000番）と衝突させないE2E専用ポート */
export const APP_PORT = 3100;
export const APP_BASE_URL = `http://localhost:${APP_PORT}`;

/** GitHub APIのモックサーバー。サーバー側からのみ参照されるためブラウザは触らない */
export const MOCK_GITHUB_PORT = 3101;
export const MOCK_GITHUB_BASE_URL = `http://127.0.0.1:${MOCK_GITHUB_PORT}`;

/**
 * レート上限の縮退表示を検証する専用のアプリインスタンス（Issue #23）。
 * レート残量（`src/lib/github/client.ts` の `rateLimitRemaining`）はモジュール状態であり、
 * フロア未満を一度観測するとそのプロセスの以降の全core呼び出しが遮断される。
 * しかも遮断はfetchの手前で起きるため、**高残量の応答を踏ませても回復できない**
 * （リクエスト自体が飛ばないので残量が更新されない）。
 * そのため縮退の検証だけを別プロセスに隔離し、3100番のテストを一切巻き込まないようにする。
 * 同じビルド成果物を `next start` するだけなので、追加のビルドは発生しない。
 */
export const RATE_LIMIT_APP_PORT = 3102;
export const RATE_LIMIT_APP_BASE_URL = `http://localhost:${RATE_LIMIT_APP_PORT}`;

/**
 * searchプールの縮退表示専用のインスタンス（Issue #42。購読面の検索欄）。
 * 3102番に同居させないのは、3102番の紙面テストが「coreが枯れても相場（searchプール）は
 * 生きている」というプール分離を恒久的にアサートしており、searchを枯らすと壊れるため。
 */
export const SEARCH_RATE_LIMIT_APP_PORT = 3103;
export const SEARCH_RATE_LIMIT_APP_BASE_URL = `http://localhost:${SEARCH_RATE_LIMIT_APP_PORT}`;

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
  // 紙面「沈黙の記録」（180日超・一年超は太字）を決定的に踏むための1件（Issue #31）。
  // モックサーバーはこのownerのリリースだけ数年前の日付で返す
  { owner: 'silent-archive', name: 'legacy-parser' },
] as const;

/**
 * 紙面「沈黙の記録」の検証用。このプレフィックスで始まるownerのリリースは、
 * モックサーバーが数年前の固定日付で返す（他のownerはサーバー起動時からの相対日付）。
 * 相対日付にしたのは、固定日付だと実時間の経過で短信（60日以内）から静かに消え、
 * 半年後に全リポジトリが沈黙の記録へ雪崩れ込む時限爆弾になるため
 */
export const SILENT_OWNER_PREFIX = 'silent';

/**
 * シードするダイジェスト（朝刊化以前の旧形式 = contentのみ）。旧データの表示互換を検証する。
 * 日付を過去に固定することで、「本日分は未生成」のNoticeが必ず出る決定的な状態を作る。
 */
export const E2E_DIGEST = {
  date: '2026-07-01',
  content:
    'vercel/next.js に v16.2.0 がリリースされ、Turbopackのビルド性能改善とApp Routerのキャッシュ制御の見直しが入りました。octocat/observability-dashboard-toolkit は依存関係の更新のみです。',
} as const;

/**
 * シードするダイジェスト（朝刊形式 = entries）。`src/lib/digest.ts` の digestEntriesSchema と
 * 同じ形にする（ずれると画面は旧形式へフォールバックし、カードのアサーションが落ちて気づける）。
 * 2件目は「実在しうる長さ」のリポジトリ名 + 本文なし（noteless）で、375pxのtruncateと
 * 「リリースノートなし」表示を同時に踏む。3件目は要約の生成失敗（noteless=false・summary=null）で、
 * 「要約を生成できませんでした」表示を踏む（Issue #36 指摘2）。
 * 総括は「3リポジトリ・3リリース（うち破壊的変更1件）」になる。
 */
export const E2E_DIGEST_ENTRIES = {
  date: '2026-07-02',
  entries: [
    {
      owner: 'vercel',
      repo: 'next.js',
      fullName: 'vercel/next.js',
      tagName: 'v16.1.0',
      releaseName: 'v16.1.0',
      publishedAt: '2026-07-02T03:00:00Z',
      headline: 'Turbopackがビルド既定に',
      summary:
        '・Turbopackが既定のビルドになった\n・App Routerのキャッシュ制御を刷新\n・画像最適化のメモリ使用量を削減',
      hasBreaking: true,
      noteless: false,
    },
    {
      owner: 'octocat',
      repo: 'observability-dashboard-toolkit',
      fullName: 'octocat/observability-dashboard-toolkit',
      tagName: 'v2.4.1',
      releaseName: null,
      publishedAt: '2026-07-01T22:30:00Z',
      headline: null,
      summary: null,
      hasBreaking: null,
      noteless: true,
    },
    {
      owner: 'prisma',
      repo: 'prisma',
      fullName: 'prisma/prisma',
      tagName: 'v7.2.0',
      releaseName: '7.2.0',
      publishedAt: '2026-07-01T21:15:00Z',
      headline: null,
      summary: null,
      hasBreaking: null,
      noteless: false,
    },
  ],
};

/**
 * 「当日の朝刊」の帰属日（YYYY-MM-DD）。アプリと同じ窓計算（digest-window.ts は
 * prisma/envに依存しない純関数モジュールなのでE2E側から直接importできる）。
 * `dayOffset` は窓終端からの日数（+1 = 翌日の窓）
 */
export function e2eDigestDay(dayOffset = 0, now = new Date()): string {
  const end = digestWindowFor(now).end;
  end.setUTCDate(end.getUTCDate() + dayOffset);
  return end.toISOString().slice(0, 10);
}

/**
 * 紙面の一面・二番手を検証するための「当日の朝刊」entries（Issue #31）。
 * global-setup が当日窓と翌日窓の2日分をこの内容でシードする。翌日分も入れるのは、
 * global-setupとテスト実行の間に21:00 UTC境界を跨いでも一面が休載にならないため。
 * 1件目（破壊的変更・headline/lede付き）が一面、2件目が二番手に選ばれる想定
 * （src/lib/paper.ts の pickFrontPage の決定則）。
 * 文言は E2E_DIGEST_ENTRIES（2026-07-02の履歴シード）と重複させない
 */
export const E2E_TODAY_DIGEST_ENTRIES = [
  {
    owner: 'vercel',
    repo: 'next.js',
    fullName: 'vercel/next.js',
    tagName: 'v16.4.0',
    releaseName: 'v16.4.0',
    publishedAt: '2026-08-02T03:00:00Z',
    headline: 'キャッシュ既定、静かに反転',
    lede: '米Vercel社は未明、v16.4.0を公開した。ビルドキャッシュの既定値を反転させる変更が柱である。',
    summary: '・ビルドキャッシュの既定値を反転\n・PPRの安定化\n・画像最適化を高速化',
    hasBreaking: true,
    noteless: false,
  },
  {
    owner: 'prisma',
    repo: 'prisma',
    fullName: 'prisma/prisma',
    tagName: 'v7.4.0',
    releaseName: '7.4.0',
    publishedAt: '2026-08-02T01:00:00Z',
    headline: 'TypedSQL、複数スキーマへ',
    lede: 'Prismaは7.4.0でTypedSQLのマルチスキーマ対応を果たした。',
    summary: '・TypedSQLがマルチスキーマ対応\n・診断ログを増強\n・接続プールの既定値を調整',
    hasBreaking: false,
    noteless: false,
  },
];

/**
 * 購読面（Issue #42）の星取帳が login 解決に使うAccount行の値。
 * global-setup がこの providerAccountId でAccount行をシードし、モックサーバーは
 * `GET /user/:id` がこのIDに一致したときだけ login を返す（他は404 = login-missing経路）。
 */
export const E2E_GITHUB_ACCOUNT = {
  providerAccountId: '99000001',
  login: 'e2e-stargazer',
} as const;

/**
 * 検索語がこのプレフィックスで始まるとき、モックは**その名前の合成銘柄を鋳造して**返す。
 * 購読→解約の往復テストが実行ごとに一意な銘柄を使い、シード11件や他テストの
 * アサーションに一切触れないための仕掛け（`slow`/`ratelimited` ownerの一意化と同じ理屈）。
 * 鋳造銘柄のownerは `minted-owner` 固定
 */
export const MINTED_REPO_PREFIX = 'minted';

/** リポジトリ詳細の404経路を踏むためのowner。モックサーバーはこのownerに対して404を返す */
export const MISSING_OWNER = 'missing';

/**
 * `MISSING_OWNER` 配下でリリース取得だけが500になるリポジトリ名。
 * 並列化後は「リポジトリが404でもリリース取得は走る」ため、その失敗を捨てて
 * 404表示になることを検証するために使う（Issue #6）。
 */
export const FAILING_RELEASES_NAME = 'releases-500';

/**
 * 並列取得（Issue #6）の検証用。このプレフィックスで始まるownerへのリクエストに対し、
 * モックサーバーは応答を遅らせたうえで開始/終了時刻を記録し、`/__requests` で返す。
 * 遅延を入れるのは、直列と並列の差を「たまたま速かった」で埋もれさせないため。
 */
export const SLOW_OWNER_PREFIX = 'slow';

/** 遅延させるミリ秒。直列なら2本目の開始が1本目の終了より後になる幅を確保する */
export const SLOW_RESPONSE_MS = 400;

/**
 * レート上限の縮退表示（Issue #23）の検証用。このプレフィックスで始まるownerへの応答は、
 * モックサーバーが `x-ratelimit-remaining` をフロア未満（0）にして返す。
 * これを踏んだアプリプロセスは以降coreプールを遮断するため、`RATE_LIMIT_APP_PORT` の
 * インスタンスに対してのみ使う。ownerの最大長は39文字（`src/lib/favorite-input.ts`）なので、
 * 一意化のサフィックスを足しても収まる短さにしておく。
 */
export const RATE_LIMITED_OWNER_PREFIX = 'ratelimited';
