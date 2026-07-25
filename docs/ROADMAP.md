# ROADMAP

各Phaseは「Claude Codeへの1〜数回の指示」で完結する粒度に切ってある。
**Phaseは順番に進める。** 各Phaseの完了条件（DoD）をすべて満たしてから次へ進む。

進め方の例: `docs/ROADMAP.md の Phase 1 を実施して。完了条件を満たしたら報告して。`

---

## Phase 0: プロジェクト初期化（半日）

- [x] `create-next-app` 相当のセットアップ（TypeScript / App Router / Tailwind / ESLint）を既存の骨組みにマージ
- [x] package.json の依存を解決し `npm install` が通る
- [x] `src/lib/env.ts` を実装（全環境変数をZodで一元検証、ビルド時はSKIP可能な遅延評価）
- [x] docker compose で Postgres 起動 → `prisma migrate dev --name init` で初回マイグレーション作成
- [x] 既存の `tests/cache-key.test.ts` がパスする

**DoD**: `npm run type-check && npm run lint && npm run test && npm run build` がすべて成功。CIが緑。

## Phase 1: 認証（半日）

- [ ] Auth.js v5 + GitHub OAuth（JWT戦略、PrismaAdapterはUser/Accountのみ）
- [ ] `/login` ページ、ヘッダーのユーザーメニュー
- [ ] 認証ガードのヘルパー（`requireSession()`）を `src/lib/` に作り、以後の全Server Actionで使用
- [ ] `requireSession` のユニットテスト

**DoD**: GitHubログイン/ログアウトが動作。未認証でServer Actionを呼ぶとエラー。

## Phase 2: GitHub APIクライアント層（1日）

- [ ] `src/lib/github/client.ts`: PAT認証fetch、`next.revalidate`、rate-limitヘッダ監視、エラーの丸め
- [ ] `src/lib/github/schemas.ts`: リポジトリ / リリース / 検索結果のZodスキーマ
- [ ] リリース一覧・リポジトリ詳細・トレンド検索の3関数
- [ ] スキーマのユニットテスト（実APIを叩かない。fixtureのJSONで検証）

**DoD**: テストで3スキーマの正常系/異常系が検証されている。実装はモック/fixtureのみでテスト可能。

## Phase 3: コア画面（2〜3日）

- [ ] お気に入り登録/解除（Server Action、`requireSession` 必須、upsertで重複安全に）
- [ ] ダッシュボード: お気に入りの最新リリースをタイムライン表示
- [ ] リポジトリ詳細: メタ情報 + リリース履歴
- [ ] トレンド: 言語別スターランキング（GitHub Search API）
- [ ] ローディング/エラー/空状態のUI

**DoD**: 主要3画面がレスポンシブで動作。お気に入りがDBに永続化される。

## Phase 4: AI要約（1日）

- [ ] `src/lib/gemini/client.ts`（リトライ・フォールバックモデル付き）
- [ ] リリース要約のServer Action:
      キャッシュ確認 → ミス時のみリリースノートをサーバーで取得しGemini呼び出し → `ReleaseSummary` に保存
- [ ] クライアントから再生成フラグを受け取らないこと（CLAUDE.md不変条件2）
- [ ] cacheKey生成とキャッシュ判定ロジックのユニットテスト

**DoD**: 同じリリースを複数回/複数ユーザーで開いてもGemini呼び出しが1回であることをログで確認。

## Phase 5: デイリーダイジェスト + Cron（1日）

- [ ] `/api/cron/digest`（`CRON_SECRET` をBearer検証）
- [ ] お気に入り横断の当日分ダイジェスト生成 → `DailyDigest` 保存
- [ ] `/digest` 画面（当日 + 過去分の閲覧）
- [ ] `vercel.json` にCron定義を追加

**DoD**: ローカルでcronエンドポイントを手動実行してダイジェストが生成・表示される。

## Phase 6: 運用仕上げ（半日）

- [ ] Vercelプロジェクト作成、環境変数設定、Supabase接続
- [ ] GitHub Actions `migrate.yml` 用のシークレット設定、本番へ `migrate deploy`
- [ ] READMEのセットアップ手順を実環境で検証（クリーンな環境で再現できるか）
- [ ] rate-limit残量が閾値以下のときの縮退動作の確認

**DoD**: 本番URLで全機能が動作。mainへのpushだけでアプリ+スキーマが更新される。

---

## スコープ外（やらないこと）

- プライベートリポジトリ対応（ユーザートークン管理が必要になるため）
- リアルタイム通知 / Webhook受信
- AI要約の多言語対応
