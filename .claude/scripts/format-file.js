#!/usr/bin/env node
// PostToolUse hook: 編集されたファイルをPrettierで整形する。
const fs = require('fs');
const { execSync } = require('child_process');

let input = '';
try {
  input = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

try {
  const data = JSON.parse(input);
  const filePath = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
  if (/\.(ts|tsx|js|jsx|json|css|md)$/.test(filePath) && fs.existsSync(filePath)) {
    execSync(`npx prettier --write "${filePath}"`, { stdio: 'ignore' });
  }
} catch {
  // 整形失敗で開発を止めない
}
process.exit(0);
