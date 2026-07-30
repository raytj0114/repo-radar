import { expect, test } from '@playwright/test';

// Issue #22 の検証専用プローブ。E2Eジョブが赤のときにルールセット protect-main が
// マージをブロックすることを実証するために意図的に失敗させる。
// このファイル・ブランチ・PRは確認後に破棄する（mainへは絶対に入れない）。
test('probe: 意図的に失敗させ、E2E必須チェックがマージゲートとして効くことを実証する', () => {
  expect('e2e-should-gate-merges').toBe('intentional-failure');
});
