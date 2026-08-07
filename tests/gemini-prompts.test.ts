import { describe, expect, it } from 'vitest';
import { buildReleaseSummaryPrompt } from '@/lib/gemini/prompts';

const base = {
  fullName: 'vercel/next.js',
  tagName: 'v16.2.0',
  name: 'v16.2.0',
  body: '## Changes\n- Fixed a bug',
};

describe('buildReleaseSummaryPrompt', () => {
  it('リポジトリ名・タグ・本文を含む', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('リポジトリ: vercel/next.js');
    expect(prompt).toContain('(v16.2.0)');
    expect(prompt).toContain('- Fixed a bug');
    expect(prompt).toContain('3行');
  });

  it('構造化出力の4項目を指示する', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('headline');
    expect(prompt).toContain('lede');
    expect(prompt).toContain('lines');
    expect(prompt).toContain('hasBreaking');
  });

  it('常体の新聞文体を指示し敬体を禁じる（第3版）', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('常体（だ・である）');
    expect(prompt).toContain('敬体（です・ます）は使わない');
  });

  it('見出しに読点区切りの新聞構文と例を指示する（第3版）', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('「〈主語となる固有名詞〉、〈動詞句の体言止め〉」');
    expect(prompt).toContain('20字程度');
    expect(prompt).toContain('リポジトリ名ではなく');
    expect(prompt).toContain('「Turbopackキャッシュ、既定を反転」');
    expect(prompt).toContain('「TypedSQL、複数スキーマへ」');
  });

  it('lines に句点終わりの完全文と行長の目安を指示する（第3版）', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('句点「。」で終わる完全な一文');
    expect(prompt).toContain('60字程度');
  });

  it('lines の最終行に事実でなく解釈を指示する（第3版）', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('最終行: 事実の繰り返しではなく解釈');
    expect(prompt).toContain('開発者に何を意味するか');
    expect(prompt).toContain('リリースノートから読み取れる範囲');
  });

  it('破壊的変更の判定基準を明示する', () => {
    const prompt = buildReleaseSummaryPrompt(base);
    expect(prompt).toContain('hasBreaking を true にする変更の例');
    expect(prompt).toContain('削除や改名');
    expect(prompt).toContain('既定値の変更');
    expect(prompt).toContain('マイグレーション');
    expect(prompt).toContain('最低バージョン');
  });

  it('リリース名がnullならタグ名で代替する', () => {
    const prompt = buildReleaseSummaryPrompt({ ...base, name: null });
    expect(prompt).toContain('リリース: v16.2.0 (v16.2.0)');
  });

  it('本文が長すぎる場合は8000文字で打ち切り省略マーカーを付ける', () => {
    const longBody = 'a'.repeat(10000);
    const prompt = buildReleaseSummaryPrompt({ ...base, body: longBody });
    expect(prompt).toContain('...(以下省略)');
    expect(prompt).not.toContain('a'.repeat(8001));
    expect(prompt).toContain('a'.repeat(8000));
  });

  it('本文が上限以下ならそのまま埋め込む', () => {
    const prompt = buildReleaseSummaryPrompt({ ...base, body: 'short body' });
    expect(prompt).toContain('short body');
    expect(prompt).not.toContain('...(以下省略)');
  });
});
