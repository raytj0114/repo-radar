# RepoRadar アーキテクチャ

## コンセプト

- お気に入りGitHubリポジトリの新着リリース・スター推移・アクティビティを一覧
- AI（Gemini）が各リリースノートを日本語3行要約（不変コンテンツなのでTTL無しでキャッシュ）
- 1日1回の「デイリーダイジェスト」（お気に入り横断の動きまとめ）

## 技術スタック

| 領域 | 選定 | 備考 |
|---|---|---|
| フレームワーク | Next.js (App Router) | Server Components中心 |
| 認証 | Auth.js (next-auth v5) + GitHub OAuth | JWT戦略。GitHubログイン=題材と一致 |
| DB | PostgreSQL (ローカル: Docker / 本番: Supabase) | Prisma + migrate運用 |
| 外部API | GitHub REST API | サーバーPATで5,000req/h |
| AI | Gemini API | キャッシュ経由のみ |
| 状態管理 | TanStack Query + Zustand | football-trackerと同構成 |
| テスト | Vitest + Testing Library | passWithNoTests: false |

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

| コンテンツ | cacheKey | TTL | 生成トリガー |
|---|---|---|---|
| リリース要約 | `owner/repo@tagName` | なし（リリースは不変） | 詳細画面の初回表示時にサーバー側で生成 |
| デイリーダイジェスト | `digest:YYYY-MM-DD:userId` | なし | Vercel Cron（または初回アクセス時） |

原則: **AI呼び出し回数 = 新規コンテンツ数**。同じリリースを何人が見ても生成は1回。
再生成が必要な場合（プロンプト改善時など）は管理者操作としてのみ実装し、クライアントに再生成フラグを渡さない。

## GitHub API戦略

- 認証: サーバー側PAT（読み取り専用・publicのみのfine-grained token）
- レート: 5,000req/h。`x-ratelimit-remaining` を監視し、閾値以下でGitHub呼び出しを控えキャッシュのみ返す
- キャッシュ: Nextの `fetch` に `next: { revalidate }` を指定
  - リリース一覧: 300s / リポジトリメタ: 3600s / トレンド検索: 1800s
- ユーザーのOAuthトークンは使わない（スコープ管理が複雑になるため。プライベートリポ対応はスコープ外）

## セキュリティ規約

- Server Actionは冒頭で `await auth()` を検証。未認証は即エラー
- 公開エンドポイント一覧（ここに無いものは全て認証必須）:
  - `GET /api/auth/*` （Auth.js）
  - `GET /api/cron/digest` （`Authorization: Bearer ${CRON_SECRET}` を検証）
- 上流APIのエラー本文をクライアントへ透過しない（汎用メッセージに丸め、詳細はサーバーログ）
- LLMプロンプトへの入力はサーバーで取得したデータのみ

## DB スキーマ方針

`prisma/schema.prisma` 参照。ポイント:

- JWT戦略のため `Session` / `VerificationToken` テーブルは持たない
- `ReleaseSummary` はTTL無し・`cacheKey` unique
- スキーマ変更は必ず `prisma migrate dev`（履歴を残す）

## デプロイ

- アプリ: Vercel（mainへのpushで自動デプロイ）
- マイグレーション: GitHub Actions `migrate.yml` が main への push 時に
  `prisma migrate deploy` を実行（`DIRECT_URL` を使用）
- Cron: Vercel Cron → `/api/cron/digest`（`vercel.json` で定義、Phase 5で追加）
