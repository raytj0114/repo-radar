# RepoRadar アーキテクチャ

## コンセプト

- お気に入りGitHubリポジトリの新着リリース・スター推移・アクティビティを一覧
- AI（Gemini）が各リリースノートを日本語3行要約（不変コンテンツなのでTTL無しでキャッシュ）
- 1日1回の「デイリーダイジェスト」（共有要約を組み立てた朝刊。追加のAI呼び出しなし）

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
│       └── prompts.ts       # リリース要約のプロンプト
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

| コンテンツ           | cacheKey                   | TTL                    | 出力                                            | 生成トリガー                                             |
| -------------------- | -------------------------- | ---------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| リリース要約         | `owner/repo@tagName`       | なし（リリースは不変） | 構造化JSON（見出し・前文・要点3行・破壊的変更） | 詳細画面の初回表示時、または日次cronの事前生成（朝刊用） |
| デイリーダイジェスト | `digest:YYYY-MM-DD:userId` | なし                   | `entries` Json（共有要約の組み立て。LLM未使用） | Vercel Cron（21:00 UTC）                                 |

原則: **AI呼び出し回数 = 新規コンテンツ数**。同じリリースを何人が見ても生成は1回。
再生成が必要な場合（プロンプト改善時など）は管理者操作としてのみ実装し、クライアントに再生成フラグを渡さない。

デイリーダイジェストの朝刊化（Issue #30、`src/lib/digest.ts`）:

- 収集窓は「前日21:00 UTC〜当日21:00 UTC」の半開区間 (start, end]。cron（`vercel.json` の `0 21 * * *`）の
  実行時刻から「now以前の直近21:00 UTC」を終端として丸めるため、発火が数分遅れても窓はずれない
- cronはまず全ユーザー横断で窓内リリースを重複排除し、未生成のものだけ共有要約（`ReleaseSummary`）を
  `src/lib/release-summary.ts` の `ensureReleaseSummary`（詳細画面のServer Actionと同じ書き込み口）で生成する。
  ユーザーごとのダイジェストは要約の組み立てのみでLLMを呼ばない（= AI呼び出しは新規リリース数にのみ比例。
  冒頭の総括はルールベース生成）。副産物として詳細画面の「AI要約を表示」は翌朝には必ずキャッシュヒットする
- 本文が空のリリースと要約生成に失敗したリリースは summary=null のエントリとして載せ、リンクのみで報じる

リリース要約の構造化（`src/lib/gemini/structured.ts`）:

- 見出し（`headline`）・前文（`lede`）・破壊的変更フラグ（`hasBreaking`）は要約と**同一の1回の呼び出し**で得る
  （`generateStructured` ＝ `responseMimeType: application/json` + `responseSchema`）。項目が増えても呼び出し回数は増えない
- 出力の検証に失敗した場合は**既存のリトライ枠（2モデル × 各2試行）の内側**で作り直す。
  枠を使い切ったら要点テキストのみで縮退保存する（`headline` が null の行 ＝ 表示側は従来のテキスト表示にフォールバック）
- `promptVersion` はプロンプト世代（1 = 構造化以前 / 2 = 構造化JSON）。TTL無しのキャッシュのまま
  プロンプトを進化させるための世代管理で、既存行の再生成は管理者操作としてのみ行う

## GitHub API戦略

- 認証: サーバー側PAT（読み取り専用・publicのみのfine-grained token）
- レート: 5,000req/h。`x-ratelimit-remaining` を監視し、閾値以下でGitHub呼び出しを控えキャッシュのみ返す
  - 残量の観測はレスポンス受信時なので、**同時に投げた分はフロア判定をすり抜けうる**（ベストエフォート）。
    並列数はページごとに定数で決め、ユーザー入力で増やせるようにしない
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
  - 構造化列（`headline` / `lede` / `hasBreaking`）は `promptVersion` 2 以降の行にのみ入る。
    既存行・縮退保存した行は null のままで、表示は `summary`（要点3行）へフォールバックする
- `DailyDigest` は朝刊化（Issue #30）以降 `entries`（Json、`src/lib/digest.ts` の `digestEntriesSchema` 準拠）
  のみを書く。`content` / `model` は朝刊化以前の行（LLM生成テキスト）の表示用に nullable で残し、
  表示側は entries が無い・検証に通らない行だけ `content` のテキスト表示へフォールバックする
- スキーマ変更は必ず `prisma migrate dev`（履歴を残す）

## E2Eの方針

`npm run e2e` は `build → start` した本番相当の成果物（3100番）に対して Playwright を
mobile(375px) / desktop の2プロファイルで実行する。認証必須画面もカバー対象（Issue #16）。
同じ成果物を 3102番でもう1プロセス起動し、レート上限の縮退表示だけをそこで検証する
（→「レート上限（縮退表示）の検証」）。
CIの `E2E (Playwright)` ジョブは**必須status check**であり、赤いままmainへマージできない
（→「デプロイ / 必須チェック（ブランチ保護）」）。

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

### レート上限（縮退表示）の検証

モックサーバーは owner が `ratelimited` で始まるリクエストに対し、応答は正常系のまま
`x-ratelimit-remaining: 0`（フロア未満）を返す。アプリは残量を**次の呼び出しの手前**で見るため、
この応答を踏んだ時点ではまだ成功し、以降のcore呼び出しが `GitHubRateLimitError` で遮断される。
`e2e/rate-limit.spec.ts` はこれを踏ませてから、リポジトリ詳細（全面Notice）と
ダッシュボード（部分Notice）の縮退表示を検証する。

**専用インスタンス（3102番）で実行する理由**: レート残量は `src/lib/github/client.ts` の
モジュール状態（プロセス単位）で、遮断はfetchの手前で起きる。つまり一度フロア未満を観測すると
リクエスト自体が飛ばなくなり残量が更新されないため、**高残量の応答を踏ませても回復できない**。
プロセスを分けることで、実行順やworkerの割り当てに関係なく3100番のテストを巻き込まない。
3102番は同じビルド成果物を `next start` するだけで、追加のビルドは発生しない
（Playwrightは `webServer` を配列順に起動する）。

トレンド（searchプール）の縮退表示は未カバー。`language` はサーバー側の許可リストで、
searchの残量を枯らせるURLをテストから作れないため（Issue #23 で範囲外と判断）。

### ストリーミング中の測定

ページ内 `<Suspense>` のフォールバック（スケルトン）には `aria-busy="true"` を付ける。
`expectNoHorizontalOverflow` はこれが全て消えるまで待ってから測る。スケルトン表示中に測ると
本来のコンテンツの横スクロールを見逃すため（不変条件7の検知漏れになる）。

## デプロイ

- アプリ: Vercel（mainへのpushで自動デプロイ）
- マイグレーション: GitHub Actions `migrate.yml` が main への push 時に
  `prisma migrate deploy` を実行（`DIRECT_URL` を使用）
- Cron: Vercel Cron → `/api/cron/digest`（`vercel.json` で定義、Phase 5で追加）

### 必須チェック（ブランチ保護）

main はルールセット `protect-main` で保護されており、PR必須 + non-fast-forward に加えて
次の3つのstatus checkが**すべて成功するまでマージできない**（いずれも `.github/workflows/ci.yml` のジョブ名）。

| context                   | ジョブ   | 主な守備範囲                                                                        |
| ------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `Lint / Typecheck / Test` | `checks` | ESLint・Prettier・型・Prismaスキーマ・ユニットテスト                                |
| `Build`                   | `build`  | プロダクションビルド                                                                |
| `E2E (Playwright)`        | `e2e`    | 375px横スクロール（不変条件7）・fetch並列化・認証必須画面のスモーク・外部通信ガード |

`E2E (Playwright)` は 2026-07-30 に追加した（Issue #22）。ルールセットの作成が
E2EジョブのCI追加（Issue #12）より前だったため必須チェックに入っておらず、
E2Eだけが検知できる回帰がCI赤のままマージできる状態だった（docs/AUDIT-2026-07.md W1）。

**ジョブ名を変えるときは必須チェックのcontext名も同時に更新する。**
不一致になると「永遠に来ないチェック」を待ち続けてマージが恒久ブロックされる。
