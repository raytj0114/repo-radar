---
description: GitHub Issueを読み、ブランチ作成から実装・検証・PR作成まで一貫して実施する
argument-hint: [issue番号]
---

GitHub Issue #$ARGUMENTS を以下の手順で実施してください。

## 手順

1. `gh issue view $ARGUMENTS` でIssue本文を読む。「受け入れ条件」と「制約」を作業の完了判定基準とする
2. CLAUDE.md の不変条件と、Issueに関係する `.claude/skills/` の規約を読み直す
3. mainを最新化し、作業ブランチを作成する（例: `feat/12-mobile-nav`、`番号-短い説明` 形式）
4. 実装する。途中で受け入れ条件と矛盾する設計判断が必要になったら、独断で進めず立ち止まって報告する
5. 検証スキル（.claude/skills/verification/SKILL.md）に従って全チェックを回す。UI変更時は375px幅の確認も行う
6. コミットし、`gh pr create` でPRを作成する。PR本文には以下を含める:
   - `Closes #$ARGUMENTS`
   - 変更概要
   - 受け入れ条件のチェックリスト（実施結果付き）
   - 確認方法（レビュワーがプレビューデプロイで何を見ればよいか）
7. PR URLを報告して終了する。**mainへの直接pushは絶対に行わない**

## 中断条件

- 受け入れ条件が曖昧で解釈が分かれる場合 → 解釈の選択肢を提示して確認を求める
- Issueのスコープを超える変更が必要と判明した場合 → 別Issue化を提案して停止する
