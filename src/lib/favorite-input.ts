import { z } from 'zod';

// お気に入りServer Actionのクライアント入力スキーマ。
// 'use server' ファイルは非同期関数しかexportできないため、スキーマはここに分離する。

// GitHubのowner名: 英数字とハイフン（先頭末尾はハイフン不可）、最大39文字
const ownerPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
// GitHubのリポジトリ名: 英数字・ハイフン・アンダースコア・ドット、最大100文字
const repoPattern = /^[a-zA-Z0-9._-]+$/;

export const favoriteTargetSchema = z.object({
  owner: z.string().min(1).max(39).regex(ownerPattern, 'owner名の形式が不正です'),
  name: z.string().min(1).max(100).regex(repoPattern, 'リポジトリ名の形式が不正です'),
});

export const addFavoriteInputSchema = favoriteTargetSchema.extend({
  // アバターはGitHubのCDNのURLのみ受け付ける（任意項目）
  avatarUrl: z
    .string()
    .url()
    .refine(
      (url) => new URL(url).hostname === 'avatars.githubusercontent.com',
      'アバターURLはGitHubのものだけ許可されます'
    )
    .nullish(),
});

export type FavoriteTarget = z.infer<typeof favoriteTargetSchema>;
export type AddFavoriteInput = z.infer<typeof addFavoriteInputSchema>;
