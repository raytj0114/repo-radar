import { describe, expect, it } from 'vitest';
import {
  STARRED_IMPORT_MAX,
  importStarredInputSchema,
  repoSearchQuerySchema,
} from '@/lib/subscription-input';

describe('repoSearchQuerySchema', () => {
  it('リポジトリ名に現れる字種と語区切りの空白を受け付ける', () => {
    expect(repoSearchQuerySchema.safeParse('next.js').success).toBe(true);
    expect(repoSearchQuerySchema.safeParse('ferris stream').success).toBe(true);
    expect(repoSearchQuerySchema.safeParse('repo_radar-2').success).toBe(true);
  });

  it('前後の空白はtrimしてから検証する', () => {
    const parsed = repoSearchQuerySchema.safeParse('  zod  ');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('zod');
  });

  it('コロンを拒否する（GitHub検索の修飾子を注入させない）', () => {
    expect(repoSearchQuerySchema.safeParse('language:rust').success).toBe(false);
    expect(repoSearchQuerySchema.safeParse('a:b').success).toBe(false);
  });

  it('引用符・記号・制御文字を拒否する', () => {
    expect(repoSearchQuerySchema.safeParse('"phrase"').success).toBe(false);
    expect(repoSearchQuerySchema.safeParse('a>b').success).toBe(false);
    expect(repoSearchQuerySchema.safeParse('a\nb').success).toBe(false);
  });

  it('空文字・空白のみ・101字以上を拒否する', () => {
    expect(repoSearchQuerySchema.safeParse('').success).toBe(false);
    expect(repoSearchQuerySchema.safeParse('   ').success).toBe(false);
    expect(repoSearchQuerySchema.safeParse('a'.repeat(101)).success).toBe(false);
  });
});

describe('importStarredInputSchema', () => {
  it('正の整数idの配列を受け付ける', () => {
    expect(importStarredInputSchema.safeParse({ ids: [1, 70107786] }).success).toBe(true);
  });

  it('空配列・上限超過を拒否する', () => {
    expect(importStarredInputSchema.safeParse({ ids: [] }).success).toBe(false);
    const tooMany = Array.from({ length: STARRED_IMPORT_MAX + 1 }, (_, i) => i + 1);
    expect(importStarredInputSchema.safeParse({ ids: tooMany }).success).toBe(false);
  });

  it('非整数・0以下・文字列idを拒否する', () => {
    expect(importStarredInputSchema.safeParse({ ids: [1.5] }).success).toBe(false);
    expect(importStarredInputSchema.safeParse({ ids: [0] }).success).toBe(false);
    expect(importStarredInputSchema.safeParse({ ids: [-1] }).success).toBe(false);
    expect(importStarredInputSchema.safeParse({ ids: ['1'] }).success).toBe(false);
  });

  it('idsが欠けていれば拒否する', () => {
    expect(importStarredInputSchema.safeParse({}).success).toBe(false);
  });
});
