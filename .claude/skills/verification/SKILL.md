---
name: verification
description: 実装タスクの完了を報告する前、およびユーザーが「確認して」「検証して」と言ったときに必ず使う。完了条件の検証手順を定義する。
---

# Verification

## 完了報告の前に必ず実行

```bash
npm run type-check
npm run lint
npm run test
npm run build
```

UI（画面・レイアウト）を変更した場合は追加で:

```bash
npm run e2e
```

すべて成功するまで「完了」と報告しない。

## 動作確認の観点

- `npm run dev` で該当画面を開き、コンソールエラーが無いこと
- 変更した機能が意図通り動くこと / 既存機能が壊れていないこと
- レスポンシブ（モバイル幅）で崩れないこと（UI変更時）
- Server Action変更時: 未認証状態で呼んだらエラーになることを確認

## DBスキーマを変更した場合

```bash
npx prisma migrate dev --name <変更内容>
```

- `prisma/migrations/` に新しいディレクトリが生成されていること
- `db push` を使っていないこと

## 失敗したとき

1. エラー全文を読み根本原因を特定する
2. 検証設定の緩和（lint disable、@ts-ignore、passWithNoTests）で回避しない
3. 修正後、このチェックリストを最初からやり直す
