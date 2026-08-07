#!/usr/bin/env node
// PreToolUse hook: 保護対象ファイルへの書き込みをブロックする。
// stdinにJSONでツール入力が渡される。exit 2 でツール実行を拒否。
const fs = require('fs');

const PROTECTED = [
  // 秘密情報。`.env.example` は値を持たないテンプレートで、CLAUDE.md 不変条件3が
  // 「env.ts と同時に更新する」ことを要求しているため保護対象から外す
  /^\.env(?!\.example$)/,
  /^prisma\/migrations\//, // 生成済みマイグレーションの手編集禁止
  /^package-lock\.json$/, // 手編集禁止（npm経由でのみ変更）
];

let input = '';
try {
  input = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

try {
  const data = JSON.parse(input);
  const filePath = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
  const rel = filePath.replace(process.cwd() + require('path').sep, '').replace(/\\/g, '/');
  if (PROTECTED.some((re) => re.test(rel))) {
    console.error(
      `Blocked: "${rel}" is a protected file. See .claude/scripts/check-protected-files.js`
    );
    process.exit(2);
  }
} catch {
  // パース不能なら通す（フェイルオープン: 開発を止めないことを優先）
}
process.exit(0);
