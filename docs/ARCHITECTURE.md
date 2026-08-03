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
│   ├── (main)/              # 認証必須（layoutはauth()ガードのみ。DOMを足さない）
│   │   ├── page.tsx         # 一面 = 紙面「日刊 RepoRadar」（Issue #31。全画面・ヘッダーなし）
│   │   ├── radio/           # 深夜放送 JORR（Issue #32。全画面・ヘッダーなし）
│   │   ├── favorites/       # 購読面 = 台帳・銘柄検索・星取帳（Issue #42。全画面・紙面意匠）
│   │   └── (chrome)/        # グローバルヘッダー + max-w-3xl コンテナの従来UI画面群
│   │       ├── trending/    # トレンド（言語別スターランキング）
│   │       ├── repos/[owner]/[name]/  # リポジトリ詳細（リリース一覧+AI要約）
│   │       └── digest/      # デイリーダイジェスト（履歴＝縮刷版）
│   ├── (auth)/login/        # ヘッダーレス（全画面センタリング）
│   ├── actions/             # Server Actions（全て認証必須）
│   │   ├── auth.ts          # signOutAction（ヘッダーと紙面奥付で共有）
│   │   ├── favorites.ts
│   │   └── summaries.ts     # AI要約の取得/生成トリガー
│   └── api/
│       ├── auth/[...nextauth]/
│       └── cron/digest/     # Vercel Cron専用（CRON_SECRETで保護）
├── components/
│   ├── features/            # paper（紙面） / radio（受信機） / releases / digest / favorites
│   ├── ui/                  # 汎用UI
│   └── layout/              # グローバルヘッダー（(chrome)配下でのみ表示）
├── lib/
│   ├── env.ts               # 環境変数の唯一の入口（Zod検証）
│   ├── prisma.ts
│   ├── digest.ts            # 朝刊の組み立て（cron本体・entriesスキーマ）
│   ├── digest-window.ts     # 収集窓の純関数（prisma/env非依存。E2Eからも直接import）
│   ├── star-snapshot.ts     # 星数の日次スナップショット採取（cron相乗り。RepoStarSnapshotの唯一の書き込み口）
│   ├── paper.ts             # 紙面の編集ロジック（純関数のみ）
│   ├── radio.ts             # 放送原稿の編集ロジック（純関数のみ。受信機UIからもimportする）
│   ├── latest-signals.ts    # お気に入りの最新リリース取得（紙面と深夜放送の共通の取得口）
│   ├── starred.ts           # GitHubスター一覧の取得口（購読面の表示と取り込みactionで共有）
│   ├── format.ts            # 表示フォーマッタ（漢数字・和文日付を含む）
│   ├── github/              # GitHub APIクライアント層
│   │   ├── client.ts        # fetch + rate-limitヘッダ処理 + /rate_limit観測
│   │   ├── schemas.ts       # レスポンスのZodスキーマ
│   │   └── cache-key.ts     # cacheKey生成
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

デイリーダイジェストの朝刊化（Issue #30 / #36、`src/lib/digest.ts`）:

- 収集窓は「前日21:00 UTC〜当日21:00 UTC」の半開区間 (start, end]。cron（`vercel.json` の `0 21 * * *`）の
  実行時刻から「now以前の直近21:00 UTC」を終端として丸めるため、発火が数分遅れても窓はずれない
- cronはまず全ユーザー横断で窓内リリースを重複排除し、未生成のものだけ共有要約（`ReleaseSummary`）を
  `src/lib/release-summary.ts` の `ensureReleaseSummary`（詳細画面のServer Actionと同じ書き込み口）で生成する。
  ユーザーごとのダイジェストは要約の組み立てのみでLLMを呼ばない（= AI呼び出しは新規リリース数にのみ比例。
  冒頭の総括はルールベース生成）。副産物として詳細画面の「AI要約を表示」は翌朝には必ずキャッシュヒットする
- 本文が空のリリースと要約生成に失敗したリリースは summary=null のエントリとして載せ、リンクのみで報じる。
  両者は `noteless` フラグで区別する（true = 本文なし / false = 生成失敗。表示ラベルも分かれる）
- **組み立ては冪等**（Issue #36）: 毎回のcronは当日窓に加えて**前日窓もバックフィル**し、窓ごとに再組み立て結果を
  既存行と比較して改善するときだけ上書きする（`compareDigestEntries` = equal / improved / regressed）。
  これにより cron自体の失敗・タイムアウト・要約の一時障害は翌日の実行で自動回復し、
  取得失敗でリリースが欠けた再実行が配達済みの朝刊を削ることもない（regressed は旧を保持）。
  #30以前の旧形式行（`content` のみ）は決して上書きしない
- cronのリリース取得は `fetchReleases` の `fresh` オプションで **Data Cacheをバイパス**する（`no-store`）。
  詳細画面と取得URLを共有するため、直前に温まったキャッシュ（最大300秒前のスナップショット）が
  窓終端のリリースを恒久的に取りこぼすのを防ぐ
- cronの `maxDuration` は300秒（Fluid compute前提）。タイムアウトしても生成済み要約はプールに残り、
  翌日のバックフィルがダイジェストを埋め直す

星数の日次スナップショット（Issue #39、`src/lib/star-snapshot.ts`）:

- cronの役割は「朝刊の組み立て」と「星数の採取」の2つ。**新規cronは立てない**（Vercel Hobbyの本数制限、
  21:00 UTC = 窓終端 = 発行時刻なので観測時刻として意味が揃う、トレンド取得を同一実行で賄える）
- **採取フェーズは要約生成より前**（実際はリリース取得よりも前）に置く。スナップショットは時点データで
  **バックフィル不能**であり、#36 の自己修復枠組みが効かない初のデータのため、タイムアウト時には
  回復不能な採取を先に済ませ、回復可能な朝刊生成を後に回す。
  「依存関係の無い取得は直列にawaitしない」原則に対する意図的な例外
- 採取対象は**当日窓のみ**（前日窓はバックフィルしない）。トレンド上位30件（相場欄の表示は6行だが、
  順位の入れ替わりで翌日の前日比が欠けないための緩衝）と、全ユーザー横断でユニーク化したお気に入り全件。
  トレンドは検索1リクエストの `stargazers_count` を再利用し、お気に入りは1リポジトリ1リクエスト。
  両方に出た銘柄は**お気に入り側（`/repos` の直接読み）を採る**: `/search` の星数は非同期に更新される
  二次インデックス越しの値で、`fresh` はNextのData Cacheにしか効かないため
  - 観測窓の長さは `src/lib/paper.ts` の `MARKET_WINDOW_DAYS` を唯一の出所とし、採取と相場欄で共有する
    （ずれると採取側の母集団が表示銘柄を包含せず、前日比が静かに欠ける）。`/trending` の窓は独立
  - ただし `createdAfter` の起点は相場欄がレンダー時刻・採取が窓終端なので、両者の窓は日中1日ずれる。
    採取側が常に等しいか広くなる向きなので表示銘柄は含まれるが、「同一の集合」ではない
    （順位の入れ替わりは上位30件の緩衝が吸収する）
- `fullName` は小文字に正規化して保存する（ケース違いのお気に入りが別行にならない）。
  同日の再実行は `@@unique([fullName, date])` + `skipDuplicates` で冪等かつ**先勝ち**。
  窓は `[D 21:00, D+1 21:00)` の24時間あるため、上書きを許すと日中の手動実行が
  「Dの21:00の観測」として何時間も後の星数を焼き付けてしまう（訂正不能・`createdAt` にも痕跡が残らない）
  - 改名リポジトリは404にならない（GitHubは301を返し `fetch` が追従する）ため、改名日を境に
    履歴が旧名・新名の2キーへ割れる。バックフィル不能なので表示側が欠測として扱う
- 採取の失敗は朝刊生成を止めない。トレンド検索（searchプール）とお気に入り（coreプール）は
  互いに巻き込まず、銘柄単位でも隔離する。フェーズごと失敗した場合はcronのレスポンスの `stars` が null になる。
  恒久欠測になる条件（トレンド失敗・取得404・書き込み失敗・観測ゼロ）は `console.error` に出す

リリース要約の構造化（`src/lib/gemini/structured.ts`）:

- 見出し（`headline`）・前文（`lede`）・破壊的変更フラグ（`hasBreaking`）は要約と**同一の1回の呼び出し**で得る
  （`generateStructured` ＝ `responseMimeType: application/json` + `responseSchema`）。項目が増えても呼び出し回数は増えない
- 出力の検証に失敗した場合は**既存のリトライ枠（2モデル × 各2試行）の内側**で作り直す。
  枠を使い切ったら要点テキストのみで縮退保存する（`headline` が null の行 ＝ 表示側は従来のテキスト表示にフォールバック）
- `promptVersion` はプロンプト世代（1 = 構造化以前 / 2 = 構造化JSON）。TTL無しのキャッシュのまま
  プロンプトを進化させるための世代管理で、既存行の再生成は管理者操作としてのみ行う

紙面「日刊 RepoRadar」（Issue #31、`/` = `src/app/(main)/page.tsx`）:

- **AI呼び出しはゼロ**。一面・二番手は当日 `DailyDigest.entries`、短信の1行目は
  `ReleaseSummary` キャッシュの**読み取りのみ**。紙面表示からAI生成は絶対に発火させない
- 日付規則は「**常に今日の号**」: 紙面日付 = 窓終端（21:00 UTC = 朝6:00 JST）のJST日付。
  朝6時に翌号へ切り替わり、号数（創刊日 `FOUNDING_DATE_JST` からの経過日数+1）は毎日進む。
  当日の朝刊が無い日は一面のみ休載表示（他欄は生きたまま）。/digest の「本日分」判定も
  同じ規則（`latestDigestDay`）を共有する
- entriesの `lede`（前文）は #31 で追加したためoptional。欠落した旧行は前文なしで組み、
  翌朝cronのバックフィルが improved 判定で自動補完する
- 一面の「最大」決定則（`pickFrontPage`）: 破壊的変更 → 見出しあり → 要約あり → 新しい順。
  二番手は一面と別リポジトリから選ぶ
- 縮退方針: **紙面は落ちない**。欄単位で休載・観測休止の枠に倒す（エラー境界へ全面では
  倒さない）。レート枠はプール別（core=短信・沈黙 / search=相場、天気はゲート外）なので
  縮退も欄別に起きる

深夜放送「JORR」（Issue #32、`/radio` = `src/app/(main)/radio/page.tsx`）:

- **AI呼び出しはゼロ**。原稿の素材は当日 `DailyDigest.entries`（朝刊）と、紙面が既に使っている
  観測値（お気に入りの最新リリース・API残量）の**読み取りのみ**。組み立ては `src/lib/radio.ts` の
  純関数で、ルールベースで日本語に読み下す
- **原稿は画面に出さない**。サーバーで組んだ `segments` はclient componentへpropsで渡すが、
  決してレンダーしない（放送は音にしか存在しない、がこの画面の主張そのもの）。
  読み上げ環境へは「受信中の局名」だけを `role="status"` で伝える
- 音はブラウザ標準のみ（声＝`speechSynthesis` / 空電・時報・チャイム＝WebAudio）で、
  **サーバー側の音声コストはゼロ**。音声一覧が空の環境では既定音声に委ね、
  `speechSynthesis` 自体が無い環境でも段落の間だけ進めて放送は止めない
- 帯は FM 76–95、局は 79.5（第一放送）/ 86.0（気象通報）/ 92.4（深夜便）。
  深夜便の本編（ソフトウェア史エピソード＝新AIコンテンツ型）は別Issueで、
  それまでは**放送休止の告知だけを流す**（実機の放送休止と同じ。開局時はsegmentsの差し替えで済む）
- 原稿の取得は **await しない**。筐体（ダイヤル・計器・ツマミ）を先に届け、番組はPromiseのまま
  client componentへ渡して後から解決させる（電源を入れるまで音は鳴らないので、原稿の到着が
  描画を待たせる理由がない）。そのため `loadPrograms` は**決してrejectしない**契約にしてある
  （RSC境界を越えたPromiseのrejectは「誰も待っていない例外」になるため）
- **縮退方針: 放送は落ちない**。素材が取れなければ休止告知に倒す（紙面の「欄単位で休載」と同じ思想）
  - 気象通報の沈黙の観測は**「観測してゼロ」と「観測できなかった」を必ず区別する**（`SilenceObservation`）。
    レート上限で最新信号を取れなかったときに「沈黙の記録はありません」と読むと、
    観測できていない事実を「異常なし」と**断言する嘘**になる（紙面の沈黙欄が観測休止に倒れるのと同じ縮退）。
    画面を見ずに聴く放送なので、聞き手には裏を取る手段が無いことに注意する
- お気に入りのリリース取得は `src/lib/latest-signals.ts` を紙面（`/`）と共有する。
  取得パラメータ（`perPage=5` / `maxPages=1`）が一致していることがNextのData Cache相乗りの条件で、
  ずれると `/` と `/radio` を続けて開くだけでGitHubへの実リクエストが倍になる
- 意匠は紙面の三色体系（紙・墨・朱）ではなく木目と琥珀。Issue #41 の「全画面を紙面意匠へ統一」の
  **意図的な例外**（一面は読むための紙、こちらは見ないで済ませるための機械）

購読面（Issue #42、`/favorites` = `src/app/(main)/favorites/page.tsx`）:

- **AI呼び出しはゼロ**。購読台帳（DB）・銘柄検索（GitHub Search）・星取帳（GitHubスター一覧）の三欄。
  紙面意匠で組み、Issue #41（全画面統一）のパイロット
- **スターの自動同期はしない**（選択式取り込みのみ）。理由は3つ:
  1. スターは「購読」でなく「しおり」の意味で押されることが多く、全量流入は「載っているものは
     全部自分ごと」という紙面の価値を毀損する
  2. お気に入り数はcronのGitHub取得量とAI呼び出し量に直結する（コスト形状が変わる）
  3. 双方向同期は削除の意味論が濁る
- スター一覧はユーザーOAuthトークンではなく**サーバーPATで公開スターのみ**読む（下記「GitHub API戦略」の
  制約に従う）。loginはセッションJWTに無いため、`Account.providerAccountId`（GitHubの数値ID）を
  `GET /user/{account_id}` でloginに解決してから `GET /users/{login}/starred` を引く
- 取り込みServer Action（`importStarredFavorites`）がクライアントから受け取るのは**リポジトリの数値IDのみ**。
  保存する owner/name/avatarUrl はサーバー側で再取得したスター一覧（canonical casing）から引き直す
  （手入力由来のcasing揺れを構造的に持ち込まない）。登録は `createMany({skipDuplicates})` で
  `addFavorite` のupsertと同じ「既存行不変・冪等」セマンティクス
- スター一覧の取得は `src/lib/starred.ts` を画面表示と取り込みactionで共有する。取得パラメータの一致が
  NextのData Cache相乗りの条件（`latest-signals.ts` と同じ注意）で、経路を分けると取り込みのたびに
  最大4リクエスト（login解決+3ページ）が再発する
- 星取帳は `?star=1` の**オプトイン表示**。既定表示のGitHub呼び出しはゼロで、検索も**送信式**
  （searchプールは30/min・フロア3と小さく、逐次検索は一人で枠を食い潰すため）
- 縮退方針は紙面と同じ「**面は落ちない**」: 欄単位で休載・観測休止に倒す。レート枠はプール別
  （core=星取帳 / search=銘柄検索）なので縮退も欄別に起きる
- 一面と違い、本文を**Suspenseでストリーミングしない**（意図的）: `next start` 環境（=E2E）では
  Suspense境界を含むページへのaction応答が完了せず、クライアントが更新を受け取れない事象が
  決定的に再現するため（詳細は `favorites/page.tsx` のコメント）。因果の帰属は未確定
  （上流 vercel/next.js #96109 はHTTP/1.1の接続数上限要因を示唆。HTTP/2のVercel本番では
  起きない可能性があり、**本番影響は未確証**）。撤去はE2E決定性のための対処で、
  既定表示の本文はDB1クエリのみ＝GitHub呼び出しゼロなのでブロッキングでも体感は変わらない。
  #41でストリーミング可否を設計制約として確定させる前にVercelプレビューで実測すること

## GitHub API戦略

- 認証: サーバー側PAT（読み取り専用・publicのみのfine-grained token）
- レート: 5,000req/h。`x-ratelimit-remaining` を監視し、閾値以下でGitHub呼び出しを控えキャッシュのみ返す
  - 残量の観測はレスポンス受信時なので、**同時に投げた分はフロア判定をすり抜けうる**（ベストエフォート）。
    並列数はページごとに定数で決め、ユーザー入力で増やせるようにしない
- キャッシュ: Nextの `fetch` に `next: { revalidate }` を指定
  - リリース一覧: 300s / リポジトリメタ: 3600s / トレンド検索・名称検索: 1800s
  - ログイン解決 `/user/{account_id}`: 3600s / スター一覧 `/users/{login}/starred`: 300s（Issue #42）
  - 例外: cron経路だけは `no-store`（`FreshOption` の `fresh`）。digest cronのリリース取得は窓の
    正確性のため（Issue #36）、星数採取のリポジトリメタ・トレンド検索は訂正不能な点データを
    古い観測で焼き付けないため（Issue #39）。画面系の経路では使わない
- 取得量は画面の表示件数に合わせる（`fetchReleases` の `perPage` / `maxPages`）
  - 紙面（/）: 最新信号だけ使うが `per_page=5` の1ページ（詳細画面とのfetchキャッシュ共有を保つ）
  - リポジトリ詳細: 履歴を全件見せるため既定（`per_page=100` × 最大3ページ）
  - スター一覧: `per_page=100` × 最大3ページ = 300件で打ち切り（選択取込の実用上限。
    取り込みactionの受理上限 `STARRED_IMPORT_MAX` から導出）/ 名称検索: `per_page=10` 固定
- 紙面はシェル（題字・日付行・奥付。同期計算のみ）を即時送出し、本文を `<Suspense>` で
  ストリーミングする。お気に入り全件のリリース取得がページ全体をブロックしないようにするため
- レート残量の観測用に `GET /rate_limit` を使う（`fetchRateLimit`、revalidate 60秒。
  このエンドポイントはレート枠を消費しない）。**フロア遮断ゲートの外**に置き、応答を残量観測に
  流さない: 残量を報じる関数が残量枯渇で死なない・遮断済みプロセスの観測を健全な値で
  上書きして遮断を解除しない、の2点のため
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
  - `signOutAction`（`src/app/actions/auth.ts`。ヘッダーと紙面奥付で共有。自セッションの破棄のみで副作用なし）
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
  - entries内の `lede` は #31 で追加したためoptional（欠落＝#31以前の行。`entryEquals` は
    欠落とnullを同一視し、バックフィルの improved 判定で自動補完される）
- `RepoStarSnapshot` は星数の日次スナップショット（Issue #39）。`@@unique([fullName, date])` で
  同日の再採取を upsert に畳む。`fullName` は小文字正規化済み・`date` は収集窓の終端のUTC日付
  - **バックフィル不能**（過去日の星数はGitHub APIから取れない）。収集開始日より前と、採り逃した日は
    永久に欠測になるため、表示側（別Issue）は欠測を前提に組む
  - 行数は銘柄数（トレンド上位 + ユニークお気に入り）にのみ比例し、ユーザー数には比例しない
- スキーマ変更は必ず `prisma migrate dev`（履歴を残す）

## E2Eの方針

`npm run e2e` は `build → start` した本番相当の成果物（3100番）に対して Playwright を
mobile(375px) / desktop の2プロファイルで実行する。認証必須画面もカバー対象（Issue #16）。
同じ成果物を 3102番（coreプール）と 3103番（searchプール）でもう2プロセス起動し、
レート上限の縮退表示だけをそこで検証する（→「レート上限（縮退表示）の検証」）。
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
`Account` 行（provider=github、`E2E_GITHUB_ACCOUNT.providerAccountId`）もここでシードする —
購読面の星取帳がloginをこの行から解決するため（Issue #42）。
シードするお気に入りは11件（`e2e/constants.ts`。10件+沈黙検証用の `silent-*`）で、
紙面のストリーミングを実サイズで踏む。ダイジェストは旧形式・朝刊形式の履歴に加えて
**当日窓と翌日窓の2日分**（`E2E_TODAY_DIGEST_ENTRIES`）をシードし、一面の検証を
21:00 UTC境界跨ぎに関係なく決定的にする（窓計算は `@/lib/digest-window` を直接importして共有）。
CIは e2e ジョブの `services.postgres` が同じ構成のDBを立てる。

モックサーバーのリリース日付は**起動時からの相対日付**で返す（固定日付だと実時間の経過で
紙面の短信（60日以内）から静かに消え、半年後に全件が沈黙の記録（180日超）へ雪崩れ込むため）。
例外として `silent-*` ownerだけは数年前の固定日付を返し、沈黙の記録の「一年超は太字」を
永続的に検証できるようにする。`GET /rate_limit` は常に4,999/5,000（=晴）を返す。

購読面（Issue #42）向けのモック:

- `GET /user/:id` は `MOCK_GITHUB_E2E_ACCOUNT_ID` に一致したときだけloginを返し、他は404
  （login解決の404経路も決定的に踏める）。`GET /users/:login/starred` は一致loginに
  `data/starred.json`（シード済みお気に入りとの重複1件・375px検証用の長銘柄を含む）を返す
- 検索モックはクエリの**平叙トークン**（`:` を含まない語）を銘柄名の部分一致に使う。
  平叙トークンが無いクエリ（トレンド・相場の `created:>...` 系）は従来どおり全件を返すため、
  既存アサーション（トレンドの件数・相場の銘柄）は影響を受けない
- 平叙トークンが `minted` で始まる場合は**その名前の合成銘柄を鋳造して返す**。
  購読→解約の往復テストが実行ごとに一意な銘柄を使い、シードデータや他テストの
  アサーションに触れないための仕掛け（`slow`/`ratelimited` ownerの一意化と同じ理屈）

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

**searchプールの縮退は 3103番**で検証する（Issue #42）。購読面の検索欄は自由語のため、
`ratelimited-` で始まる検索語で「残量0を観測させる1訪目 → 遮断される2訪目」を作れる
（Issue #23 時点のトレンドは `language` が許可リストでこのURLを作れず範囲外だった）。
3102番に同居させないのは、3102番の紙面テストが「coreが枯れても相場（searchプール）は
生きている」というプール分離を恒久的にアサートしており、searchを枯らすと壊れるため。

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
