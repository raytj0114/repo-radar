# RepoRadar アーキテクチャ

## コンセプト

- お気に入りGitHubリポジトリの新着リリース・スター推移・アクティビティを一覧
- AI（Gemini）が各リリースノートを日本語3行要約（不変コンテンツなのでTTL無しでキャッシュ）
- 1日1回の「デイリーダイジェスト」（お気に入り横断の動きまとめ）

## 技術スタック

| 領域           | 選定                                           | 備考                               |
| -------------- | ---------------------------------------------- | ---------------------------------- |
| フレームワーク | Next.js (App Router)                           | Server Components中心              |
| 認証           | Auth.js (next-auth v5) + GitHub OAuth          | JWT戦略。GitHubログイン=題材と一致 |
| DB             | PostgreSQL (ローカル: Docker / 本番: Supabase) | Prisma + migrate運用               |
| 外部API        | GitHub REST API                                | サーバーPATで5,000req/h            |
| AI             | Gemini API                                     | キャッシュ経由のみ                 |
| 状態管理       | TanStack Query + Zustand                       | football-trackerと同構成           |
| テスト（単体） | Vitest + Testing Library                       | passWithNoTests: false             |
| テスト（E2E）  | Playwright (Chromium)                          | 375px / desktop の2プロファイル    |

## ディレクトリ構成（計画）

```
src/
├── app/
│   ├── (main)/              # 認証後のメイン画面群
│   │   ├── page.tsx         # ダッシュボード（お気に入りの新着リリース）
│   │   ├── trending/        # トレンド（言語別スターランキング）
│   │   ├── repos/[owner]/[name]/  # リポジトリ詳細（リリース一覧+AI要約）
│   │   ├── favorites/       # お気に入り管理
│   │   └── digest/          # デイリーダイジェスト
│   ├── (auth)/login/
│   ├── actions/             # Server Actions（全て認証必須）
│   │   ├── favorites.ts
│   │   └── summaries.ts     # AI要約の取得/生成トリガー
│   └── api/
│       ├── auth/[...nextauth]/
│       └── cron/digest/     # Vercel Cron専用（CRON_SECRETで保護）
├── components/
│   ├── features/            # repos / releases / trending / digest / favorites
│   ├── ui/                  # 汎用UI
│   └── layout/
├── lib/
│   ├── env.ts               # 環境変数の唯一の入口（Zod検証）
│   ├── prisma.ts
│   ├── github/              # GitHub APIクライアント層
│   │   ├── client.ts        # fetch + ETag + rate-limitヘッダ処理
│   │   ├── schemas.ts       # レスポンスのZodスキーマ
│   │   └── cache-key.ts     # cacheKey生成（実装済み・テストの雛形）
│   └── gemini/
│       ├── client.ts
│       └── prompts.ts       # 要約/ダイジェストのプロンプト
├── hooks/
└── types/

tests/                       # Vitest（純粋関数・Server Action・コンポーネント）
e2e/                         # Playwright（下記「E2Eの方針」参照）
├── constants.ts             # ポート・E2E用シークレット・シードデータの唯一の出所
├── fixtures.ts              # 認証済みテスト拡張 / 外部通信ガード / 共通アサーション
├── global-setup.ts          # E2E専用DBの migrate deploy とシード
└── mock-github/             # GitHub REST APIのモックサーバーと応答データ
```

## データフロー

```
ブラウザ
  │  (Server Components / Server Actions)
  ▼
Next.js サーバー
  ├─→ GitHub API  … 公開データ取得。Next fetchキャッシュ + ETagで節約
  ├─→ PostgreSQL  … お気に入り / AI要約キャッシュ / ダイジェスト
  └─→ Gemini API  … キャッシュミス時のみ。結果は必ずDBへ保存
```

## AIコスト設計（最重要）

| コンテンツ           | cacheKey                   | TTL                    | 生成トリガー                           |
| -------------------- | -------------------------- | ---------------------- | -------------------------------------- |
| リリース要約         | `owner/repo@tagName`       | なし（リリースは不変） | 詳細画面の初回表示時にサーバー側で生成 |
| デイリーダイジェスト | `digest:YYYY-MM-DD:userId` | なし                   | Vercel Cron（または初回アクセス時）    |

原則: **AI呼び出し回数 = 新規コンテンツ数**。同じリリースを何人が見ても生成は1回。
再生成が必要な場合（プロンプト改善時など）は管理者操作としてのみ実装し、クライアントに再生成フラグを渡さない。

## GitHub API戦略

- 認証: サーバー側PAT（読み取り専用・publicのみのfine-grained token）
- レート: 5,000req/h。`x-ratelimit-remaining` を監視し、閾値以下でGitHub呼び出しを控えキャッシュのみ返す
- キャッシュ: Nextの `fetch` に `next: { revalidate }` を指定
  - リリース一覧: 300s / リポジトリメタ: 3600s / トレンド検索: 1800s
- 取得量は画面の表示件数に合わせる（`fetchReleases` の `perPage` / `maxPages`）
  - ダッシュボード: 1リポジトリ5件表示なので `per_page=5` の1ページのみ
  - リポジトリ詳細: 履歴を全件見せるため既定（`per_page=100` × 最大3ページ）
- ダッシュボードは見出し（シェル）を即時送出し、タイムラインを `<Suspense>` でストリーミングする。
  お気に入り全件のリリース取得がページ全体をブロックしないようにするため
- **依存関係の無い取得は直列に await しない**（待ち時間が加算されるため）。`src/lib/github/concurrent.ts` の
  `settle` で包んで `Promise.all` にまとめ、使う直前に `unwrapSettled` で取り出す
  - リポジトリ詳細: リポジトリメタ / リリース一覧 / お気に入り判定（Prisma）を同時に投げる。
    リポジトリが404ならリリースの結果は成功・失敗とも捨てる（`unwrapSettled` を呼ばない）
  - トレンド: トレンド検索とお気に入り一覧（Prisma）を同時に投げる
  - レート上限（`GitHubRateLimitError`）だけは `RATE_LIMITED` 番兵に変換して縮退表示に落とす。
    それ以外の例外は握りつぶさずそのまま投げ直す
- ユーザーのOAuthトークンは使わない（スコープ管理が複雑になるため。プライベートリポ対応はスコープ外）

## セキュリティ規約

- Server Actionは冒頭で `await auth()` を検証。未認証は即エラー
- 公開エンドポイント一覧（ここに無いものは全て認証必須）:
  - `GET/POST /api/auth/*` （Auth.js。CSRF検証はAuth.js内蔵）
  - `/login` のsignIn Server Action（GitHub OAuthへのリダイレクトのみ。実処理はAuth.js側）
  - ヘッダーのsignOut Server Action（自セッションの破棄のみで副作用なし）
  - `GET /api/cron/digest` （`Authorization: Bearer ${CRON_SECRET}` を検証）
- 上流APIのエラー本文をクライアントへ透過しない（汎用メッセージに丸め、詳細はサーバーログ）
- LLMプロンプトへの入力はサーバーで取得したデータのみ

## DB スキーマ方針

`prisma/schema.prisma` 参照。ポイント:

- JWT戦略のため `Session` / `VerificationToken` テーブルは持たない
- `ReleaseSummary` はTTL無し・`cacheKey` unique
- スキーマ変更は必ず `prisma migrate dev`（履歴を残す）

## E2Eの方針

`npm run e2e` は `build → start` した本番相当の成果物（3100番）に対して Playwright を
mobile(375px) / desktop の2プロファイルで実行する。認証必須画面もカバー対象（Issue #16）。

**外部APIは一切叩かない。** 認証必須画面のデータ取得はServer Component / Server Actionからの
サーバー側fetchであり、Playwrightの `page.route()` では捕まえられないため、次の3点で担保する。

| 対象           | 方針                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| GitHub API     | `GITHUB_API_BASE_URL` を `e2e/mock-github/server.mjs`（3101番）へ向ける                      |
| Gemini API     | AI要約はボタン押下でのみ発火するため、スモークでは押さない                                   |
| アバター画像等 | `/_next/image` と `/_vercel/*` をブラウザ側でスタブし、`next/image` のサーバー側取得を止める |

加えて `e2e/fixtures.ts` が **localhost以外へのリクエストを検出したらテストを落とす**ガードを
全テストに掛けており、回帰で外部通信が復活したら気づけるようにしている。

### 認証（セッションの作り方）

`next-auth/jwt` の `encode` でセッションJWTを署名し、`authjs.session-token` Cookie を
Playwrightから注入する。**アプリコードに認証バイパスの分岐は一切追加しない**（不変条件1）。

署名鍵は `e2e/constants.ts` の `E2E_AUTH_SECRET` を `playwright.config.ts` の
`webServer.env` でサーバーへ渡して一致させる。Next.jsは既に `process.env` にある値を
`.env.local` で上書きしないため、ローカルでもCIでも同じ鍵になる。

### DB

開発用DBを汚さないよう、E2Eは専用DB（既定 `repo_radar_e2e`、`E2E_DATABASE_URL` で変更可）を使う。
`e2e/global-setup.ts` が `prisma migrate deploy` を実行し、テストが期待する固定データを投入する。
シードするお気に入りは10件（`e2e/constants.ts`）で、ダッシュボードのストリーミングを実サイズで踏む。
CIは e2e ジョブの `services.postgres` が同じ構成のDBを立てる。

### 並列取得の検証

モックサーバーは owner が `slow` で始まるリクエストの応答を意図的に遅らせ（`SLOW_RESPONSE_MS`）、
開始・終了時刻を記録して `GET /__requests?owner=...` で返す。リポジトリ詳細のE2Eはこの時刻から
「リリースの取得開始 < リポジトリメタの応答完了」を検証しており、直列に戻すと落ちる。
画面の表示時間ではなくリクエストの時刻で判定するため、実行環境の速度に左右されない。
ownerは実行ごとに一意にする（Nextのfetchキャッシュに当たるとリクエスト自体が発生しないため）。

### ストリーミング中の測定

ページ内 `<Suspense>` のフォールバック（スケルトン）には `aria-busy="true"` を付ける。
`expectNoHorizontalOverflow` はこれが全て消えるまで待ってから測る。スケルトン表示中に測ると
本来のコンテンツの横スクロールを見逃すため（不変条件7の検知漏れになる）。

## デプロイ

- アプリ: Vercel（mainへのpushで自動デプロイ）
- マイグレーション: GitHub Actions `migrate.yml` が main への push 時に
  `prisma migrate deploy` を実行（`DIRECT_URL` を使用）
- Cron: Vercel Cron → `/api/cron/digest`（`vercel.json` で定義、Phase 5で追加）
