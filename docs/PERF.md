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

### 認証済み（本来の主要画面）— 未計測

認証済みセッションが必要なためCLIでは自動計測できない。下記「認証済み画面の計測手順」で手動計測し、この表に追記する。

| URL         | 画面           | Performance | LCP | CLS | TBT | 計測日 |
| ----------- | -------------- | ----------- | --- | --- | --- | ------ |
| `/`         | ダッシュボード | --          | --  | --  | --  | --     |
| `/trending` | トレンド       | --          | --  | --  | --  | --     |

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
