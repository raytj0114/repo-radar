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
