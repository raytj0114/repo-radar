// プロンプト生成（純粋関数）。
// 入力は必ずサーバーでGitHub APIから取得したデータのみ（ai-cost-guard 5）。
// クライアント由来の文字列を直接ここへ渡してはならない。

const MAX_BODY_CHARS = 8000;
const MAX_DIGEST_ENTRIES = 20;
const MAX_DIGEST_BODY_CHARS = 1500;

export type ReleaseSummarySource = {
  /** GitHub APIのrepository.full_name（クライアント入力ではない） */
  fullName: string;
  tagName: string;
  name: string | null;
  body: string;
};

export function buildReleaseSummaryPrompt(source: ReleaseSummarySource): string {
  const body =
    source.body.length > MAX_BODY_CHARS
      ? `${source.body.slice(0, MAX_BODY_CHARS)}\n...(以下省略)`
      : source.body;

  return [
    'あなたはソフトウェアのリリースノートを日本語で要約するアシスタントです。',
    '以下のGitHubリリースノートを、開発者向けに日本語でちょうど3行に要約してください。',
    '各行は「・」で始まる箇条書きとし、破壊的変更・新機能・重要な修正を優先してください。',
    '要約以外の前置きや後書きは出力しないでください。',
    '',
    `リポジトリ: ${source.fullName}`,
    `リリース: ${source.name ?? source.tagName} (${source.tagName})`,
    '--- リリースノート ---',
    body,
  ].join('\n');
}

export type DigestEntry = {
  /** GitHub API由来のfullName（クライアント入力ではない） */
  fullName: string;
  tagName: string;
  name: string | null;
  body: string;
};

export function buildDailyDigestPrompt(input: { date: string; entries: DigestEntry[] }): string {
  const sections = input.entries.slice(0, MAX_DIGEST_ENTRIES).map((entry) => {
    const body =
      entry.body.length > MAX_DIGEST_BODY_CHARS
        ? `${entry.body.slice(0, MAX_DIGEST_BODY_CHARS)}\n...(以下省略)`
        : entry.body;
    return `### ${entry.fullName} ${entry.name ?? entry.tagName} (${entry.tagName})\n${body}`;
  });

  return [
    'あなたは開発者向けのデイリーダイジェストを書くアシスタントです。',
    `以下は${input.date}（UTC）に公開された、お気に入りリポジトリのリリース一覧です。`,
    '全体を日本語でまとめてください。構成:',
    '- 冒頭に1〜2文の総括',
    '- 続けてリポジトリごとに「・リポジトリ名: 要点」の箇条書き（各1行）',
    '- 破壊的変更・新機能を優先し、細かな修正はまとめて言及する',
    '前置きや後書きは出力しないでください。',
    '',
    ...sections,
  ].join('\n');
}
