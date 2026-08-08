import { expect, test, watchConsoleErrors } from './fixtures';
import { MINTED_REPO_PREFIX } from './constants';

// 同一ページServer Action（購読トグル）の往復（Issue #49）。
//
// `docs/ARCHITECTURE.md`「レンダリング制約: Suspense × 同一ページServer Action」の回帰ガード。
// 同一ページのactionを持つ画面にSuspense境界（`loading.tsx` によるルート境界を含む）を置くと、
// action応答がクライアントへ届かず**星ボタンが永久に押した状態にならない**（Issue #47 の実測で
// 素のHTTP/1.1では 7〜12/20）。サーバー側は書き込み済みなので、リロードすると反映されている。
// ＝**押した直後のボタン表示の変化**だけがこの故障の signal であり、リロード後のDB確認では
// 検出できない。ここで意図的に画面を再読み込みしないのはそのため。
//
// 画面単位で割ってある他のspec（`authed.spec.ts` = スモーク / `favorites.spec.ts` = 購読面）に
// 対し、このspecは**画面を跨いだ制約の回帰ガード**として独立させている。
//
// 変異テストの設計原則は `favorites.spec.ts` 冒頭コメントに従う（シード11件は解約しない・
// 一意な鋳造銘柄で往復する・件数を固定しない）。

/** 鋳造銘柄のowner。モックは `/repos/:owner/:name` の owner/name から合成リポジトリを組み立てる */
const MINTED_OWNER = 'minted-owner';

/**
 * トレンド面の往復対象。一覧はモック固定の3件（`mock-github/data/search-repositories.json`）で
 * 鋳造銘柄を差し込めないため、既存銘柄を一時的に購読する。3件のうち選べるのは `nolang` だけ:
 * - `observability-dashboard-toolkit`: シード購読済み（`E2E_FAVORITES`）＝解約してはいけない
 * - `ferris-stream-processor`: `favorites.spec.ts` が検索語 `ferris` の結果表で
 *   リンク1件を期待している。購読すると台帳にも同名リンクが出て strict mode 違反で落ちる
 * `nolang` を見ている他specは紙面の相場欄（`authed.spec.ts` の「日割」）だけで、
 * 相場は検索由来＝購読状態に依らない
 */
const TRENDING_TARGET = 'octocat/nolang';

/**
 * この往復は**1プロファイルだけで回す**（375pxの表示検証は `responsive.spec.ts` が持つ。
 * 押した直後に反映されるかはビューポートに依らない）。
 *
 * 複数のブラウザが**同時に購読を変える**と、境界を外した後でも同じ症状（永久pending、
 * または遷移は終わるのに古い状態のまま）が数%残る。Issue #49 で実測
 * （`--repeat-each` は `fullyParallel` で複数workerに散るため、下記は同時実行下の数字）:
 * - トレンド面の往復だけを多重化: **10/40 赤**。対象銘柄もURL（`?language=`）も分けたうえで
 *   再現する＝同一行・同一URLの奪い合いではなく、**購読変更の同時実行**そのものが条件
 * - リポジトリ詳細の往復（銘柄・URLとも実行ごとに一意）を多重化: **1/40 赤**
 * - 直列（`--workers=1`）なら **80/80 緑**。Issue #47 の計測ハーネス（workers:1）でも **80/80 緑**
 * - 対照: `favorites.spec.ts` の往復（購読面＝再レンダーがDB1クエリ）は同じ多重化で **20/20 緑**
 *   ＝再レンダーでGitHub取得を伴う `(chrome)` の2画面にだけ出る
 * - `(chrome)/error.tsx` を外しても 3/40 → 1/40 で、原因の切り分けには足りない（error.tsxは残した）
 *
 * 境界の有無とは独立した別の引き金だが、**追跡Issueは立てていない**（Issue #49 で裁定）。
 * 実運用の条件（同一ユーザーが複数ブラウザで同時に購読を変える）が現実的でなく、本番は
 * HTTP/2で#47の実測でも影響が小さいため。ここに実測を残すのが記録の全てで、**このspecが
 * CIでフレークし始めたときが起票の時**。そのときはこのコメントから始めればよい。
 *
 * このspecで見たいのは「Suspense境界 × 同一ページaction」の回帰なので、同時に走る変異の数を
 * 1プロファイル分に抑えて無関係な条件を持ち込まない（`npm run e2e` の通常実行では各テスト1回ずつ）。
 */
const ROUNDTRIP_PROJECT = 'desktop';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== ROUNDTRIP_PROJECT,
    `購読変更の同時実行を避けるため ${ROUNDTRIP_PROJECT} だけで回す`
  );
});

/**
 * 反映を待つ上限。Issue #47 のハーネスと同じ10秒にし、判定の基準を実測と揃える。
 * この故障は**永久pending**（成功時の中央値は71〜134ms。待って直るものではない）なので、
 * 既定の5秒から延ばしても検出力は落ちない。
 */
const UI_UPDATE_TIMEOUT_MS = 10_000;

test.describe('購読トグルの往復', () => {
  test('リポジトリ詳細: 押した直後に星の状態が反転し、もう一度押すと戻る', async ({
    page,
  }, testInfo) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    // 実行ごとに一意な銘柄。他specのアンカー（シード11件・トレンド一覧）に一切触れない
    const name = `${MINTED_REPO_PREFIX}-detail-${testInfo.project.name}-${Date.now()}`;
    await page.goto(`/repos/${MINTED_OWNER}/${name}`);

    const addButton = page.getByRole('button', { name: 'お気に入りに追加' });
    const removeButton = page.getByRole('button', { name: 'お気に入りから外す' });

    await expect(addButton).toBeVisible();
    await addButton.click();
    // 表示が変わる＝action応答が届き、サーバーの再レンダーがクライアントに反映された
    await expect(removeButton).toBeVisible({ timeout: UI_UPDATE_TIMEOUT_MS });

    await removeButton.click();
    await expect(addButton).toBeVisible({ timeout: UI_UPDATE_TIMEOUT_MS });

    assertNoConsoleErrors();
  });

  test('トレンド: 押した直後に星の状態が反転し、もう一度押すと戻る', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);

    await page.goto('/trending');
    // トレンド面は全表（table）+ 購読判子（SubscribeToggle）で組まれる（Issue #41）。
    // 見ているものは変わらない: 押した直後の aria-pressed の反転＝action応答の到達
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: TRENDING_TARGET }) });
    const star = row.getByRole('button', { name: /購読/ });
    await expect(star).toBeVisible();

    // 開始状態は固定しない。前回の実行が故障（＝UIは戻らないがサーバーは書き込み済み）で
    // 終わっていると購読済みから始まるため、**現在の状態から反転して戻る**ことだけを見る
    const before = await star.getAttribute('aria-pressed');
    const flipped = before === 'true' ? 'false' : 'true';

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', flipped, {
      timeout: UI_UPDATE_TIMEOUT_MS,
    });

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', before ?? 'false', {
      timeout: UI_UPDATE_TIMEOUT_MS,
    });

    assertNoConsoleErrors();
  });
});
