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
  // 相場欄の「日割」（作成からの1日平均★）の分母に使う（Issue #31）。
  // optionalなのは後付けのフィールドだから: Next.jsのData Cacheはデプロイを跨いで残るため、
  // 必須にすると追加直後の最大1時間（search 1800s / repository 3600s）、キャッシュ済みの
  // 旧形式レスポンスがパースに落ちて画面ごと502になる。欠落時は日割欄を「─」に縮退する
  created_at: z.string().datetime().optional(),
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

/**
 * `GET /rate_limit` のレスポンス。紙面の天気欄（API残量）に使う（Issue #31）。
 * 使うのはcoreプールの残量と上限のみ
 */
export const rateLimitSchema = z.object({
  resources: z.object({
    core: z.object({
      limit: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
    }),
  }),
});

export type Repository = z.infer<typeof repositorySchema>;
export type Release = z.infer<typeof releaseSchema>;
export type SearchRepositoriesResult = z.infer<typeof searchRepositoriesSchema>;
export type RateLimitSnapshot = z.infer<typeof rateLimitSchema>['resources']['core'];
