import { describe, expect, it } from 'vitest';
import { addFavoriteInputSchema, favoriteTargetSchema } from '@/lib/favorite-input';

describe('favoriteTargetSchema', () => {
  it('通常のowner/リポジトリ名を受け付ける', () => {
    expect(favoriteTargetSchema.safeParse({ owner: 'vercel', name: 'next.js' }).success).toBe(true);
  });

  it('パス区切りやクエリの混入を拒否する', () => {
    expect(favoriteTargetSchema.safeParse({ owner: 'a/b', name: 'c' }).success).toBe(false);
    expect(favoriteTargetSchema.safeParse({ owner: 'a', name: 'c?x=1' }).success).toBe(false);
  });

  it('空文字・長すぎる値を拒否する', () => {
    expect(favoriteTargetSchema.safeParse({ owner: '', name: 'x' }).success).toBe(false);
    expect(favoriteTargetSchema.safeParse({ owner: 'a'.repeat(40), name: 'x' }).success).toBe(
      false
    );
  });
});

describe('addFavoriteInputSchema', () => {
  it('GitHubのアバターURLを受け付ける', () => {
    const input = {
      owner: 'vercel',
      name: 'next.js',
      avatarUrl: 'https://avatars.githubusercontent.com/u/14985020?v=4',
    };
    expect(addFavoriteInputSchema.safeParse(input).success).toBe(true);
  });

  it('GitHub以外のホストのアバターURLを拒否する', () => {
    const input = { owner: 'a', name: 'b', avatarUrl: 'https://evil.example.com/x.png' };
    expect(addFavoriteInputSchema.safeParse(input).success).toBe(false);
  });

  it('avatarUrlは省略可能', () => {
    expect(addFavoriteInputSchema.safeParse({ owner: 'a', name: 'b' }).success).toBe(true);
  });
});
