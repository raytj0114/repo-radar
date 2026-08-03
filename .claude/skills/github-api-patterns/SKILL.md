---
name: github-api-patterns
description: GitHub REST APIを呼ぶコード（src/lib/github/ 配下、リリース取得、トレンド検索、レート制限処理）を実装・修正するときは必ずこのスキルを使う。fetchの書き方、レート制限、ページネーション、エラー処理の規約を定義する。
---

# GitHub API Patterns

## 基本形

- ベースURL: `https://api.github.com`
- ヘッダ: `Authorization: Bearer ${env.GITHUB_API_TOKEN}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
- 認証は必ず `src/lib/env.ts` 経由。`process.env` 直読み禁止

## キャッシュ

Nextの `fetch` オプションで宣言する:

| データ                                        | revalidate |
| --------------------------------------------- | ---------- |
| リリース一覧 `/repos/{o}/{r}/releases`        | 300        |
| リポジトリメタ `/repos/{o}/{r}`               | 3600       |
| トレンド検索・名称検索 `/search/repositories` | 1800       |
| ログイン解決 `/user/{account_id}`             | 3600       |
| スター一覧 `/users/{login}/starred`           | 300        |

例外: cron経路だけ `{ fresh: true }`（`FreshOption`）で `no-store` にする。**画面系の経路では使わない**
（指定はサーバー側の定数のみで行う）。

| 経路                                                                                   | 理由                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| digest cronのリリース取得 `fetchReleases`                                              | 「最大revalidate秒前のスナップショット」が窓終端の恒久的な取りこぼしになる    |
| 星数採取のリポジトリメタ `fetchRepository` / トレンド検索 `searchTrendingRepositories` | スナップショットは訂正不能な点データ。古い観測を21:00 UTCの値として記録しない |

## レート制限

- レスポンスヘッダ `x-ratelimit-remaining` を毎回読む
- **レート枠はリソース別**（`core`: 5,000/h、`search`: 30/min）。残量は必ず `x-ratelimit-resource` 単位で追跡・判定する。グローバルに判定すると検索1回でcore側まで誤遮断する
- 残量がフロア（core: 100 / search: 3）未満のとき: そのプールへの新規呼び出しを行わず、キャッシュ済みデータのみで応答するか明示的なエラーを返す（黙って空を返さない）
- `403/429` は `retry-after` を尊重。無条件リトライ禁止

## レスポンス検証

- すべてのレスポンスは `src/lib/github/schemas.ts` のZodスキーマで `safeParse` する
- スキーマは実レスポンスのfixture（`tests/fixtures/`）に対してテストする。実APIを叩くテストは書かない

## ページネーション

- `per_page` を明示（GitHubの上限は100）。`Link` ヘッダの `rel="next"` を辿る
- 無限に辿らない。用途ごとに上限ページ数を定数化する（例: リリースの既定は最大3ページ、
  スター一覧は `per_page=100` × 最大3ページ = 300件で打ち切り）
- **表示件数が決まっている画面では取得量も絞る**。`fetchReleases(owner, repo, { perPage, maxPages })` のように呼び出し側で指定する（例: ダッシュボードは1リポジトリ5件なので `per_page=5` の1ページのみ）
- 取得量の指定はサーバー側の定数だけで決める。クライアント入力を渡さない（CLAUDE.md 不変条件1）

## エラー処理

- 上流のエラー本文をクライアントへ透過しない。`GitHubAPIError(status, safeMessage)` に丸め、原文は `console.error` へ
- 404（リポジトリ消滅・改名）は想定内として扱い、UIで空状態を出せる型にする
