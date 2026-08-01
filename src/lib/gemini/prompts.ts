import { SUMMARY_LINE_COUNT } from '@/lib/gemini/structured';

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

/**
 * リリース要約の構造化生成プロンプト。
 * 出力形式は `src/lib/gemini/structured.ts` の responseSchema / Zodスキーマと対になっている。
 */
export function buildReleaseSummaryPrompt(source: ReleaseSummarySource): string {
  const body =
    source.body.length > MAX_BODY_CHARS
      ? `${source.body.slice(0, MAX_BODY_CHARS)}\n...(以下省略)`
      : source.body;

  return [
    'あなたはソフトウェアのリリースを日本語で伝える技術記事の編集者です。',
    '以下のGitHubリリースノートを読み、次の4項目からなるJSONオブジェクトだけを出力してください。',
    '',
    '- headline: 新聞の見出しのような日本語の一文（20字程度・体言止め・リポジトリ名は含めない）',
    '- lede: 見出しを補う前文（日本語1〜2文・120字以内）',
    `- lines: 開発者向けの要点をちょうど${SUMMARY_LINE_COUNT}行（各行は本文のみ。「・」などの記号を先頭に付けない）`,
    '- hasBreaking: 利用者側に修正作業が生じる変更を含むなら true、含まないなら false',
    '',
    'hasBreaking を true にする変更の例:',
    '- 公開API・CLIオプション・設定項目の削除や改名',
    '- 既定値の変更により既存の挙動が変わる',
    '- マイグレーションや手作業での移行が必要',
    '- 対応する言語・ランタイム・依存パッケージの最低バージョンの引き上げ',
    'バグ修正・性能改善・後方互換な機能追加だけであれば false にしてください。',
    '',
    'lines では破壊的変更・新機能・重要な修正を優先し、JSON以外の文字は出力しないでください。',
    '',
    `リポジトリ: ${source.fullName}`,
    `リリース: ${source.name ?? source.tagName} (${source.tagName})`,
    '--- リリースノート ---',
    body,
  ].join('\n');
}
