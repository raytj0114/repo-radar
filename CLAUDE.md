# RepoRadar

GitHubリポジトリのリリース・トレンドを追跡し、AIがリリースノートを日本語要約するWebアプリ。

## このファイルの目的

Claudeが自律的に高品質な実装を行うためのルールを定義する。
仕様・設計は `docs/ARCHITECTURE.md`、実装順序は `docs/ROADMAP.md` を参照すること。
**実装前に必ず両方を読む。**

## プロジェクト不変条件（絶対に破らない）

1. **Server Action / Route Handler は認証必須がデフォルト**
   - 例外（公開エンドポイント）を作る場合は `docs/ARCHITECTURE.md` の「公開エンドポイント一覧」に追記し、レート制御を必ず付ける
   - `skipCache` のようなコスト制御を無効化する引数をクライアントから受け取らない
2. **AI（Gemini）呼び出しは必ずキャッシュ層を経由する**
   - cacheKey = `owner/repo@tagName`（リリース要約）または `date`（デイリーダイジェスト）
   - AI呼び出し回数はコンテンツ数にのみ比例させる。ユーザー数に比例させない
   - LLMへの入力はサーバー側で取得したデータのみ。クライアント入力をプロンプトに直接埋め込まない
3. **環境変数は `src/lib/env.ts` 経由でのみ読む**
   - `process.env` の直読みは `env.ts` 内部のみ許可
   - 変数を追加したら `env.ts` のスキーマと `.env.example` を**同時に**更新する
4. **DBスキーマ変更は必ず `prisma migrate dev` で行う**
   - `prisma db push` は使用禁止。マイグレーション履歴のないスキーマ変更はレビューで却下される
5. **機能実装にはテストを伴う**
   - 純粋関数（cacheKey生成、Zodスキーマ、日付処理）は必ずユニットテストを書く
   - `passWithNoTests` に頼らない（vitest設定でfalse固定）
6. **変更は必ずブランチ + PR経由で行う。mainへの直接pushは禁止**
7. **UI変更時は375px幅（モバイルビューポート）での表示確認をDoDに含める**
   - 横スクロールの発生有無は `npm run e2e`（Playwright、375px/desktop）で自動検証する

## 品質原則

1. **細部に魂を込める**: 内部のコード・命名・構造にも最大限のこだわりを持つ
2. **一貫性を徹底する**: UI文言を変えたら関連する変数名・ファイル名も揃える
3. **妥協しない**: 「動けばいい」ではなく「正しくあるべき」を追求する

## 検証ループ（最重要）

すべての実装は「実装 → 検証 → 修正」のループを回す。

### 実装前

1. `docs/ARCHITECTURE.md` と関連する既存コードを確認し、パターンを把握する
2. 使用パッケージの現在のバージョン（package.json）と最新ドキュメントを確認する
3. 不明点は推測せず調査する

### 実装後（必ず実行、すべてパスするまで修正）

```bash
npm run type-check
npm run lint
npm run test
npm run build
npm run e2e   # UI変更時。build→startした成果物に対しPlaywrightを375px/desktopで実行
npm run dev   # ブラウザで変更箇所を目視確認
```

### 検証で問題が見つかった場合

1. エラーメッセージを全文読み、根本原因を特定する
2. 推測で修正せず、ドキュメントやコードを確認する
3. 修正後、検証ループを最初から回す
4. 同じエラーが繰り返される場合、アプローチ自体を見直す

## 禁止事項

- 動作確認せずに「完了」と報告すること
- エラーを無視または握りつぶすこと
- 既存コードのパターンを確認せずに実装すること
- 検証系の設定（lint無効化コメント、`passWithNoTests`、`@ts-ignore`）で問題を隠すこと
- ROADMAPのフェーズを飛ばして先の機能を実装すること（依存関係が壊れる）

## 主要コマンド

```bash
npm run dev              # 開発サーバー
npm run build            # プロダクションビルド
npm run lint             # ESLint
npm run type-check       # TypeScript検査
npm run test             # Vitest（watchなし）
npm run e2e              # Playwright E2E（自動でbuild→startして実行、3100番）
npm run format           # Prettier
npx prisma migrate dev   # マイグレーション作成+適用（ローカル）
npx prisma studio        # DB GUI
```

## GitHub API利用の要点

- サーバー側PAT（`GITHUB_API_TOKEN`）で認証し、5,000req/hのレート枠を使う
- 詳細は `.claude/skills/github-api-patterns/SKILL.md` を参照（ETag・ページネーション・レート制限ヘッダの扱い）
