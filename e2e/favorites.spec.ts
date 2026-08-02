import { expect, test, watchConsoleErrors } from './fixtures';
import { E2E_FAVORITES, MINTED_REPO_PREFIX } from './constants';

// 購読面（Issue #42）のスモーク。
//
// 変異（購読・解約・取り込み）を伴うテストの設計原則:
// - シード11件（E2E_FAVORITES）は絶対に解約しない（紙面・詳細画面の他specのアンカー）
// - 購読→解約の往復は、実行ごとに一意な「鋳造銘柄」（MINTED_REPO_PREFIX 始まりの検索語に
//   モックが合成銘柄を返す）で行い、プロジェクト間・リトライ間で識別子が衝突しないようにする
// - 取り込み対象（starred.json の stargazer/*）は固定identityなので「追加のみ・終状態のみ」を
//   検証する。mobile/desktopの2プロジェクトが並走しても createMany(skipDuplicates) で冪等
// - 台帳・星取の件数は正確な数を固定しない（並走する変異で変わる）。不変な数（星取の5銘柄）だけ固定する

const [PRIMARY_FAVORITE] = E2E_FAVORITES;
const PRIMARY_FULL_NAME = `${PRIMARY_FAVORITE.owner}/${PRIMARY_FAVORITE.name}`;

test.describe('購読面', () => {
  test('台帳・検索・星取帳の三欄と奥付ナビが組まれる', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/favorites');

    await expect(page.getByRole('heading', { name: '購読面', level: 1 })).toBeVisible();
    await expect(page.getByText('購読の受付')).toBeVisible();

    // 台帳: シードの先頭銘柄が載る。件数は変異テストの並走で変わるため正確な数を固定しない
    await expect(page.getByRole('link', { name: PRIMARY_FULL_NAME })).toBeVisible();
    await expect(page.getByText(/購読中　\S+銘柄/)).toBeVisible();

    // 検索欄（送信式）と星取帳の扉。開くまでGitHubへは行かない
    await expect(page.getByLabel('検索語')).toBeVisible();
    await expect(page.getByRole('button', { name: '検索' })).toBeVisible();
    await expect(page.getByRole('link', { name: '星取帳を繰る' })).toBeVisible();

    // 奥付ならぬフッタ: 一面への帰り道とログアウト
    await expect(page.getByRole('link', { name: '一面へ戻る' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('button', { name: '退勤（ログアウト）' })).toBeVisible();

    assertNoConsoleErrors();
  });

  test('検索フォームの送信で結果表が組まれ、検索語が残る', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/favorites');

    await page.getByLabel('検索語').fill('ferris');
    await page.getByRole('button', { name: '検索' }).click();

    await expect(page).toHaveURL(/\/favorites\?q=ferris$/);
    await expect(page.getByRole('link', { name: 'octocat/ferris-stream-processor' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'octocat/ferris-stream-processorを購読する' })
    ).toBeVisible();
    await expect(page.getByLabel('検索語')).toHaveValue('ferris');

    assertNoConsoleErrors();
  });

  test('検索0件は「該当銘柄なし」の休載枠になる', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/favorites?q=zzz-no-hit');

    await expect(page.getByText('該当銘柄なし。')).toBeVisible();

    assertNoConsoleErrors();
  });

  test('不正な検索語は面を落とさず案内に倒す', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    // コロンはGitHub検索の修飾子注入になるため検証で弾く。URL直叩きでも同じ経路に落ちる
    await page.goto('/favorites?q=a:b');

    await expect(page.getByText(/検索語に使えない字/)).toBeVisible();
    // 台帳（DB）は生きている＝欄単位の縮退
    await expect(page.getByRole('link', { name: PRIMARY_FULL_NAME })).toBeVisible();

    assertNoConsoleErrors();
  });

  test('検索結果から購読し、台帳から解約できる（鋳造銘柄で往復）', async ({ page }, testInfo) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    const name = `${MINTED_REPO_PREFIX}-${testInfo.project.name}-${Date.now()}`;
    const fullName = `minted-owner/${name}`;
    await page.goto(`/favorites?q=${name}`);

    // 購読前: 検索結果の1行のみ（台帳には無い）
    await expect(page.getByRole('link', { name: fullName })).toHaveCount(1);
    await page.getByRole('button', { name: `${fullName}を購読する` }).click();

    // 購読後: revalidateで台帳にも現れ、行は2箇所になる
    await expect(page.getByRole('link', { name: fullName })).toHaveCount(2);

    // 台帳側の解約（同名ボタンが台帳と検索結果に1つずつ。どちらを押しても同じactionなのでfirstでよい）
    await page
      .getByRole('button', { name: `${fullName}の購読をやめる` })
      .first()
      .click();
    await expect(page.getByRole('link', { name: fullName })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `${fullName}を購読する` })).toBeVisible();

    assertNoConsoleErrors();
  });

  test('星取帳を繰ると5銘柄が並び、購読済みは記帳できない', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/favorites?star=1');

    // 星取の総数はstarredフィクスチャで固定（購読中の内訳は変異テストの並走で変わるため見ない）
    await expect(page.getByText(/星取　五銘柄/)).toBeVisible();

    // シード済みお気に入りとの重複は「購読中」標つきでチェック不能
    const subscribedRow = page.locator('li').filter({ hasText: 'vercel/next.js' });
    await expect(subscribedRow.getByText('購読中')).toBeVisible();
    await expect(subscribedRow.getByRole('checkbox')).toBeDisabled();

    // 実在しうる長さの銘柄名も1行に収まる（375pxの折返しは responsive.spec が測る）
    await expect(
      page.getByText(/starlight-telemetry-collector-suite-for-quiet-observatories/)
    ).toBeVisible();

    // 未選択のうちは記帳できない
    await expect(page.getByRole('button', { name: '選択の銘柄を一括購読' })).toBeDisabled();

    assertNoConsoleErrors();
  });

  test('選んだ銘柄だけが一括購読で台帳に載る', async ({ page }) => {
    const assertNoConsoleErrors = watchConsoleErrors(page);
    await page.goto('/favorites?star=1');
    await expect(page.getByText(/星取　五銘柄/)).toBeVisible();

    // 並走する相手プロジェクトが先に取り込んでいると checkbox は購読中でdisabledになっている。
    // その場合は選択をスキップし、終状態（台帳に存在）だけを検証する（skipDuplicatesで冪等）
    for (const target of ['stargazer/quiet-import-target', 'stargazer/orbital-import-target']) {
      const checkbox = page.locator('li').filter({ hasText: target }).getByRole('checkbox');
      if (await checkbox.isEnabled()) {
        await checkbox.check();
      }
    }
    const submit = page.getByRole('button', { name: '選択の銘柄を一括購読' });
    if (await submit.isEnabled()) {
      await submit.click();
    }

    // 台帳に両銘柄が載る（星取帳側はリンクを持たないため、リンクの出現＝台帳の行）
    await expect(page.getByRole('link', { name: 'stargazer/quiet-import-target' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'stargazer/orbital-import-target' })).toBeVisible();
    // 選ばなかった残置銘柄は台帳へ流入しない（自動同期しない設計の検証）
    await expect(page.getByRole('link', { name: 'stargazer/remains-unimported' })).toHaveCount(0);

    assertNoConsoleErrors();
  });
});
