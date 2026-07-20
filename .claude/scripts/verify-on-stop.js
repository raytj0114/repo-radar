#!/usr/bin/env node
// Stop hook: セッション終了時に型チェックとlintを軽く回し、壊れた状態での「完了」を防ぐ。
const { execSync } = require('child_process');

function run(label, cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error(`[verify-on-stop] ${label} failed:\n` + String(e.stdout || e.message).slice(0, 4000));
    return false;
  }
}

const ok = run('type-check', 'npm run type-check') & run('lint', 'npm run lint');
if (!ok) {
  // exit 2 でClaudeに失敗内容がフィードバックされ、修正を続行させる
  process.exit(2);
}
process.exit(0);
