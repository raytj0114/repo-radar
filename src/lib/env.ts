import { z } from 'zod';

// 環境変数の唯一の入口（CLAUDE.md 不変条件3）。
// process.env の直読みはこのファイル内のみ許可。
// 変数を増減したら .env.example も必ず同時に更新すること。
const envSchema = z.object({
  // GitHub API（サーバー側PAT / read-only, public repos のみ）
  GITHUB_API_TOKEN: z.string().min(1),

  // GitHub REST APIのベースURL。未設定なら公開GitHub（src/lib/github/client.ts の既定値）。
  // E2Eではローカルのモックサーバーへ向けて外部通信を断つ（e2e/mock-github/server.mjs）
  GITHUB_API_BASE_URL: z.string().url().optional(),

  // Auth.js (next-auth v5)
  AUTH_SECRET: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),

  // Gemini API
  GOOGLE_GEMINI_API_KEY: z.string().min(1),

  // Vercel Cron からの呼び出し検証用
  CRON_SECRET: z.string().min(1),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

function loadEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `環境変数の検証に失敗しました。.env.example を参照して .env.local を設定してください。\n${details}`
    );
  }

  cached = parsed.data;
  return cached;
}

// 遅延評価のProxy。import時ではなく最初のプロパティアクセス時に検証するため、
// 環境変数が揃わないビルド環境（CI）でもモジュール読み込み自体は失敗しない。
// SKIP_ENV_VALIDATION=true はCIビルド専用のエスケープハッチ（.github/workflows/ci.yml 参照）。
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    // スキーマ外のプロパティ（`await` のthenableチェックによる `then` 等）では検証を発火させない
    if (typeof prop !== 'string' || !(prop in envSchema.shape)) return undefined;
    if (process.env.SKIP_ENV_VALIDATION === 'true') {
      return process.env[prop];
    }
    return loadEnv()[prop as keyof Env];
  },
});
