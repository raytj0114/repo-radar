import { z } from 'zod';

// 購読面（Issue #42）のクライアント入力スキーマ。
// 'use server' ファイルは非同期関数しかexportできないため、スキーマはここに分離する。

/**
 * スター取り込みの上限件数（perPage 100 × 3ページ）。
 * `src/lib/github/client.ts` の `STARRED_FETCH.maxPages` はこの値から導出し、
 * 「画面に出せる件数」と「actionが受け付ける件数」が構造的にずれないようにする
 */
export const STARRED_IMPORT_MAX = 300;

/**
 * 銘柄検索の検索語。`:` や引用符を文字クラスで排除し、GitHub検索の修飾子
 * （`language:` 等）をクライアント入力から注入できないようにする。
 * 許可はリポジトリ名に現れる字種（英数・`.` `_` `-`）+ 語区切りの空白のみ
 */
export const repoSearchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._\- ]+$/, '検索語に使えない文字が含まれています');

/**
 * スター取り込みの入力。クライアントから受け取るのはGitHubリポジトリの数値IDのみ。
 * owner/name等の文字列はサーバー側で再取得したスター一覧から引き直すため、
 * ここを通っても保存内容には一切影響しない（canonical casingの担保）
 */
export const importStarredInputSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(STARRED_IMPORT_MAX),
});

export type ImportStarredInput = z.infer<typeof importStarredInputSchema>;
