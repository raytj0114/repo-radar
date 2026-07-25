# RepoRadar

お気に入りGitHubリポジトリのリリース・トレンドを追跡し、AIがリリースノートを日本語要約するWebアプリ。

> **状態**: Phase 0〜5 実装済み（認証 / GitHub API層 / コア画面 / AI要約 / デイリーダイジェスト）。残りは `docs/ROADMAP.md` の Phase 6（運用仕上げ）。

## ドキュメント

| ファイル                                     | 内容                                    |
| -------------------------------------------- | --------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 設計・データフロー・セキュリティ規約    |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | 実装フェーズと完了条件                  |
| [CLAUDE.md](CLAUDE.md)                       | Claude Code向けの開発ルール（不変条件） |

## セットアップ

```bash
# 1. 依存インストール
npm install

# 2. 環境変数
cp .env.example .env
# .env を編集（各値の入手先はファイル内コメント参照）
# 注: Next.jsは .env.local も読むが、Prisma CLI（migrate等）は .env しか読まないため .env を推奨

# 3. DB起動 + マイグレーション
docker compose up -d
npx prisma migrate dev

# 4. 開発サーバー
npm run dev
```

## Claude Codeでの開発

```bash
claude
# 例: 「docs/ROADMAP.md の Phase 0 を実施して」
# または /phase Phase 0
```

- `/phase <Phase名>` — ROADMAPのフェーズを実行
- `/verify` — 検証ループを実行
- `/review` — 不変条件の観点で直近の変更をレビュー

## デプロイ

- アプリ: Vercel（mainへのpushで自動デプロイ）
- DBマイグレーション: GitHub Actions `migrate.yml`（要 `PROD_DIRECT_URL` シークレット）
- 詳細: `docs/ARCHITECTURE.md` の「デプロイ」節
