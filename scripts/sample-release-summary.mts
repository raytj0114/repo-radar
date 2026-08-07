/**
 * リリース要約プロンプトの実生成サンプラ（開発用ツール。アプリからは参照しない）。
 *
 * プロンプトを調整するときの標準検証法: 実装と同一経路
 * （buildReleaseSummaryPrompt → generateStructured → parseStructuredReleaseSummary）で
 * 毛色の違う実リリースを生成し、文体契約を機械チェック+目視で確かめる。
 * DBには一切書かない（キャッシュを汚さない）。PR #52 のマージ前検証で使った方式の定着。
 *
 * 実行: プロジェクトルートで
 *   npx -y tsx scripts/sample-release-summary.mts
 * コスト: Gemini呼び出しは SAMPLES の本数 × 1回（リトライ枠は実装と同じ）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env.local を process.env へ（env.ts の検証より先に読み込む）
for (const rawLine of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (line === '' || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!(key in process.env)) process.env[key] = value;
}

// env を要求するモジュールは .env.local 読み込み後に動的import
const { env } = await import(new URL('../src/lib/env.ts', import.meta.url).href);
const { buildReleaseSummaryPrompt } = await import(
  new URL('../src/lib/gemini/prompts.ts', import.meta.url).href
);
const { generateStructured } = await import(
  new URL('../src/lib/gemini/client.ts', import.meta.url).href
);
const { parseStructuredReleaseSummary, releaseSummaryResponseSchema, SUMMARY_LINE_COUNT } =
  await import(new URL('../src/lib/gemini/structured.ts', import.meta.url).href);

type Sample = { owner: string; repo: string; note: string };

// 毛色の違う4本: 大型フレームワーク / モノレポ系（コード記法が多い） /
// 修正のみのパッチ / 古参・本文が短い傾向
const SAMPLES: Sample[] = [
  { owner: 'vercel', repo: 'next.js', note: 'フレームワークの大型リリース' },
  { owner: 'prisma', repo: 'prisma', note: 'モノレポ系・コード記法が多い' },
  { owner: 'vitest-dev', repo: 'vitest', note: '修正のみのパッチが多い' },
  { owner: 'expressjs', repo: 'express', note: '古参・本文が短い傾向' },
];

async function fetchLatestRelease(owner: string, repo: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_API_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${owner}/${repo}: ${res.status}`);
  const json = (await res.json()) as {
    tag_name: string;
    name: string | null;
    body: string | null;
  };
  return { tagName: json.tag_name, name: json.name, body: json.body ?? '' };
}

function check(label: string, ok: boolean): string {
  return `  [${ok ? 'OK' : 'NG'}] ${label}`;
}

let failures = 0;

for (const sample of SAMPLES) {
  const fullName = `${sample.owner}/${sample.repo}`;
  const release = await fetchLatestRelease(sample.owner, sample.repo);
  const prompt = buildReleaseSummaryPrompt({
    fullName,
    tagName: release.tagName,
    name: release.name,
    body: release.body,
  });
  const { data, model } = await generateStructured(prompt, {
    responseSchema: releaseSummaryResponseSchema,
    validate: parseStructuredReleaseSummary,
  });

  console.log('='.repeat(72));
  console.log(`${fullName} ${release.tagName}（${sample.note}） model=${model}`);
  if (!data) {
    failures++;
    console.log('  [NG] 構造化に失敗（縮退テキストのみ）');
    continue;
  }

  console.log(`見出し: ${data.headline}`);
  console.log(`前文  : ${data.lede}`);
  data.lines.forEach((line: string, i: number) => console.log(`本文${i + 1}: ${line}`));
  console.log(`破壊的: ${data.hasBreaking}`);

  const repoWords = [sample.repo, fullName];
  const allText = [data.headline, data.lede, ...data.lines];
  const checks: [string, boolean][] = [
    ['見出しに読点「、」がある', data.headline.includes('、')],
    ['見出しは28字以内（20字程度）', [...data.headline].length <= 28],
    [
      '見出しにリポジトリ名を含まない',
      !repoWords.some((w) => data.headline.toLowerCase().includes(w.toLowerCase())),
    ],
    [`本文は${SUMMARY_LINE_COUNT}行`, data.lines.length === SUMMARY_LINE_COUNT],
    ['全行が句点で終わる', data.lines.every((l: string) => /[。．]$/.test(l))],
    ['行頭に記号がない', data.lines.every((l: string) => !/^[・\-*]/.test(l))],
    ['各行80字以内（60字程度）', data.lines.every((l: string) => [...l].length <= 80)],
    [
      '敬体（です・ます）を含まない',
      !data.lines.some((l: string) => /(です|ます)[。．]?$/.test(l)),
    ],
    ['前文120字以内', [...data.lede].length <= 120],
    [
      'マークダウン記法（`・**）を含まない（紙面はそのまま印字）',
      !allText.some((t) => t.includes('`') || t.includes('**')),
    ],
  ];
  for (const [label, ok] of checks) {
    if (!ok) failures++;
    console.log(check(label, ok));
  }
}

console.log('='.repeat(72));
console.log(
  failures === 0 ? '機械チェックすべてOK（最終行の解釈の質は目視で判定）' : `NG ${failures}件`
);
