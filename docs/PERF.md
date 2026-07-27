# パフォーマンス計測

速度改善（M2）の効果検証に使うベースラインと、再計測の手順を記録する。

## ベースライン

### 未認証（初訪問体験）— 2026-07-26

- 計測対象: 本番 `https://repo-radar-sigma.vercel.app`
- 計測ツール: Lighthouse 13.4.1（CLI、モバイルエミュレーション + Simulated throttling のデフォルト設定）
- 注意: `/` と `/trending` は認証ガードにより `/login` へ307リダイレクトされるため、この計測は「リダイレクトを含むログイン画面表示まで」の初訪問体験を表す。認証済み画面そのものの数値は次節を参照。

| URL         | 最終表示URL              | Performance | LCP   | CLS | TBT   |
| ----------- | ------------------------ | ----------- | ----- | --- | ----- |
| `/login`    | `/login`                 | 100         | 1.3 s | 0   | 60 ms |
| `/`         | `/login`（リダイレクト） | 100         | 1.7 s | 0   | 30 ms |
| `/trending` | `/login`（リダイレクト） | 100         | 1.4 s | 0   | 50 ms |

その他カテゴリ（3URL共通）: Accessibility 100 / Best Practices 96 / SEO 100

### 認証済み（本来の主要画面）

認証済みセッションが必要なためCLIでは自動計測できない。下記「認証済み画面の計測手順」で手動計測し、この表に追記する。

**M2の改善効果判定にはこの値をベースラインとして使う**（拡張機能を削除したプロファイルで計測したクリーンな値）。

| URL         | 画面           | Performance | LCP   | CLS   | TBT   | 計測日     |
| ----------- | -------------- | ----------- | ----- | ----- | ----- | ---------- |
| `/`         | ダッシュボード | 100         | 1.9 s | 0.001 | 30 ms | 2026-07-26 |
| `/trending` | トレンド       | 99          | 2.1 s | 0.001 | 30 ms | 2026-07-26 |

計測条件（両画面共通）: Chrome DevTools Lighthouse 13.3.0 / Mobile / Simulated throttling デフォルト。

参考値（同日・拡張機能あり）:

| URL         | 画面     | Performance | LCP   | CLS | TBT    | 備考                                                     |
| ----------- | -------- | ----------- | ----- | --- | ------ | -------------------------------------------------------- |
| `/trending` | トレンド | 82          | 2.1 s | 0   | 640 ms | TBTのうち約300msは拡張機能（DeepL）由来の長タスク        |
| `/login`    | ログイン | 90          | 1.7 s | 0   | 20 ms  | Speed Index 13.0 sの異常値は拡張由来でスコアを押し下げた |

初回計測は拡張機能が有効な通常プロファイルで行ったため、Lighthouseが「Chrome拡張がページ読み込みに悪影響」と警告した。拡張機能を削除して再計測した結果が上のベースライン表であり、参考値の表はベースラインとしては使わない。

## 改善記録

### ダッシュボードのストリーミング化とリリース取得の軽量化（Issue #5）— 2026-07-27

**変更内容**

1. ダッシュボードのシェル（見出し）を即時送出し、タイムラインを `<Suspense>` の内側へ移した（フォールバックはスケルトン）
2. ダッシュボードのリリース取得を `per_page=5` の1ページのみに変更（リポジトリ詳細の全件取得は現状維持）

**GitHub API 取得量（1リポジトリあたり、実測）**

- 変更前: `per_page=100` を `Link: rel="next"` で最大3ページ辿る（最大300件）
- 変更後: `per_page=5` の1ページのみ（ダッシュボードの表示上限は1リポジトリ5件）

| リポジトリ     | 変更前                     | 変更後                | 本文バイト数の削減 |
| -------------- | -------------------------- | --------------------- | ------------------ |
| vercel/next.js | 3 req / 300件 / 907.7 KiB  | 1 req / 5件 / 15.0KiB | -98.3%             |
| facebook/react | 2 req / 132件 / 888.4 KiB  | 1 req / 5件 / 10.1KiB | -98.9%             |
| prisma/prisma  | 3 req / 248件 / 1719.1 KiB | 1 req / 5件 / 36.1KiB | -97.9%             |

お気に入り10件のダッシュボード1回表示に換算すると、リクエスト数は約27回 → 10回、
転送量（非圧縮の本文）は約11.4 MiB → 約204 KiB になる（上記3リポジトリの平均から外挿）。

計測条件: 2026-07-27、公開エンドポイントへ未認証で `curl`（`Accept-Encoding` 指定なし＝非圧縮）。
`Link: rel="next"` が途切れる場合は実際のページ数がアプリの上限3より少なくなる（facebook/react の2 req はこのケース）。

```bash
# 変更前相当（最大3ページ）。rel="next" が無くなったら以降のページは発生しない
for page in 1 2 3; do curl -sS -w '%{size_download}\n' -o /dev/null \
  "https://api.github.com/repos/vercel/next.js/releases?per_page=100&page=$page"; done
# 変更後相当（1ページのみ）
curl -sS -w '%{size_download}\n' -o /dev/null \
  "https://api.github.com/repos/vercel/next.js/releases?per_page=5"
```

**シェル先行描画の確認**

初回レスポンスのHTMLが「見出し → スケルトン → 後追いのリリース本体」の順で届くことを
E2E（`e2e/authed.spec.ts` の「シェルはリリース取得を待たずに先に送出される」）で自動検証している。
描画タイミングではなくバイト列の順序を見るため、モックの応答が速くてもすり抜けない。
E2Eのシードはお気に入り10件（`e2e/constants.ts`）。

**未実施**

認証済み画面のLighthouse再計測は下記「認証済み画面の計測手順（手動）」に従う必要があるため、
本デプロイ後にユーザー手動で実施し、上のベースライン表へ日付付きで追記する。

## 計測の実施方法

### 未認証（CLI・自動）

Chromeがインストールされた環境で以下を実行する（Lighthouseのデフォルトがモバイルエミュレーション + Simulated throttling）。

```bash
npx lighthouse https://repo-radar-sigma.vercel.app/login \
  --output=json --output-path=./lh-login.json \
  --chrome-flags="--headless=new"
```

`/` と `/trending` もURLを変えて同様に実行する。結果のJSONから以下を読み取る:

- Performance スコア: `categories.performance.score`（×100）
- LCP: `audits['largest-contentful-paint'].displayValue`
- CLS: `audits['cumulative-layout-shift'].displayValue`
- TBT: `audits['total-blocking-time'].displayValue`

HTMLレポートで見たい場合は `--output=html` にする。

### 認証済み画面の計測手順（手動）

1. ChromeでGitHubログイン済みの状態で対象画面（`/` または `/trending`）を開く
2. DevTools → Lighthouse タブを開く
3. Device: **Mobile** / Categories: Performance を選択（Throttlingはデフォルトのまま）
4. 「Analyze page load」を実行し、Performance スコアと LCP / CLS / TBT を上の表に日付付きで追記する

シークレットウィンドウではセッションが無いためリダイレクトされる点に注意。通常ウィンドウで実行すると拡張機能が数値に影響しうるため、極端な値が出た場合は拡張機能を無効化したプロファイルで再計測する。

### フィールドデータ（実ユーザー計測）

`@vercel/speed-insights` / `@vercel/analytics` を導入済み（`src/app/layout.tsx`）。デプロイ後の実ユーザーのCore Web Vitalsは Vercelダッシュボード → 対象プロジェクト → **Speed Insights** で確認する（初回はダッシュボード側でEnableが必要。データ反映には訪問がある程度必要）。

## 記録のルール

- 再計測したら既存行を上書きせず、日付付きで新しいセクション（または行）を追加する
- 改善施策の前後で必ず同じ手順・同じ設定で計測する
