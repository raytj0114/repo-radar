// プロンプト生成（純粋関数）。
// 入力は必ずサーバーでGitHub APIから取得したデータのみ（ai-cost-guard 5）。
// クライアント由来の文字列を直接ここへ渡してはならない。

const MAX_BODY_CHARS = 8000;

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
