import { z } from 'zod';

// GitHub REST APIレスポンスのZodスキーマ。
// アプリで使うフィールドのみ定義する（未知のフィールドはparse時に落とされる）。
// 変更時は tests/fixtures/github/ のfixtureに対するテストも更新すること。

export const repositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({
    login: z.string(),
    avatar_url: z.string().url(),
  }),
  html_url: z.string().url(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  open_issues_count: z.number().int().nonnegative(),
  pushed_at: z.string().datetime().nullable(),
});

export const releaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullable(),
  // リリースノート本文。空リリースではnull/未定義がありうる
  body: z.string().nullable().optional(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.string().url(),
  // draftリリースでは公開日時がnull
  published_at: z.string().datetime().nullable(),
});

export const releaseListSchema = z.array(releaseSchema);

export const searchRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(repositorySchema),
});

export type Repository = z.infer<typeof repositorySchema>;
export type Release = z.infer<typeof releaseSchema>;
export type SearchRepositoriesResult = z.infer<typeof searchRepositoriesSchema>;
