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
    'あなたは技術系日刊紙「日刊 RepoRadar」の整理部記者です。',
    '以下のGitHubリリースノートを読み、次の4項目からなるJSONオブジェクトだけを出力してください。',
    '記事の文体はすべて常体（だ・である）の新聞文体で統一し、敬体（です・ます）は使わないでください。',
    '',
    '- headline: 新聞の見出し。「〈主語となる固有名詞〉、〈動詞句の体言止め〉」の読点区切りで20字程度。',
    '  主語にはリポジトリ名ではなく、変更の主役となる機能・API・設定などの固有名詞を置いてください。',
    '  リポジトリ名・製品名・バージョン番号は見出しに入れないでください（見出しの脇に別途刷られます）。',
    '  主役と呼べる固有名詞が無い修正中心のリリースでは、対象領域を主語にしてください（「〜実行系」「〜基盤」のような機能群の呼び名）。',
    '  例: 「Turbopackキャッシュ、既定を反転」「TypedSQL、複数スキーマへ」',
    '- lede: 見出しを補う前文（1〜2文・120字以内）。このリリースの柱が何かを地の文で伝えてください',
    `- lines: 記事本文をちょうど${SUMMARY_LINE_COUNT}行。各行は箇条書きの断片ではなく、句点「。」で終わる完全な一文として書いてください（各行60字程度、長くても80字。「・」などの記号を行頭に付けない）`,
    `  - 1〜${SUMMARY_LINE_COUNT - 1}行目: 破壊的変更・新機能・重要な修正を優先した事実の要点`,
    '  - 最終行: 事実の繰り返しではなく解釈。この変更が開発者に何を意味するかを、リリースノートから読み取れる範囲で一文にしてください（型の例: 「この慎重さに16系の設計思想が見える。」）。どのリリースにも当てはまる一般論（「安定性が向上するだろう」「開発体験が向上する」など）は解釈と呼びません。解釈も新聞の地の文で書き、「〜と解釈できる」「〜と考えられる」のような注釈語は使いません',
    '- hasBreaking: 利用者側に修正作業が生じる変更を含むなら true、含まないなら false',
    '',
    'hasBreaking を true にする変更の例:',
    '- 公開API・CLIオプション・設定項目の削除や改名',
    '- 既定値の変更により既存の挙動が変わる',
    '- マイグレーションや手作業での移行が必要',
    '- 対応する言語・ランタイム・依存パッケージの最低バージョンの引き上げ',
    'バグ修正・性能改善・後方互換な機能追加だけであれば false にしてください。',
    '',
    'JSON以外の文字は出力しないでください。',
    '',
    `リポジトリ: ${source.fullName}`,
    `リリース: ${source.name ?? source.tagName} (${source.tagName})`,
    '--- リリースノート ---',
    body,
  ].join('\n');
}
