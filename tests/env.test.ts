import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_ENV = {
  GITHUB_API_TOKEN: 'ghp_test',
  AUTH_SECRET: 'auth-secret',
  AUTH_GITHUB_ID: 'client-id',
  AUTH_GITHUB_SECRET: 'client-secret',
  GOOGLE_GEMINI_API_KEY: 'gemini-key',
  CRON_SECRET: 'cron-secret',
  DATABASE_URL: 'postgresql://postgres:password@localhost:5432/repo_radar',
  DIRECT_URL: 'postgresql://postgres:password@localhost:5432/repo_radar',
} as const;

// envモジュールは検証結果をキャッシュするため、テストごとに再importする
async function importEnv() {
  vi.resetModules();
  const mod = await import('@/lib/env');
  return mod.env;
}

describe('env', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const key of [...Object.keys(VALID_ENV), 'SKIP_ENV_VALIDATION']) {
      vi.stubEnv(key, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('すべての環境変数が揃っていれば値を読める', async () => {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, value);
    }
    const env = await importEnv();
    expect(env.GITHUB_API_TOKEN).toBe('ghp_test');
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
  });

  it('必須変数が欠けている場合、import時ではなくアクセス時にエラーになる（遅延評価）', async () => {
    const env = await importEnv();
    expect(() => env.GITHUB_API_TOKEN).toThrowError(/環境変数の検証に失敗しました/);
  });

  it('エラーメッセージに欠けている変数名が含まれる', async () => {
    const env = await importEnv();
    expect(() => env.GITHUB_API_TOKEN).toThrowError(/GITHUB_API_TOKEN/);
  });

  it('DATABASE_URL がURL形式でない場合はエラーになる', async () => {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv('DATABASE_URL', 'not-a-url');
    const env = await importEnv();
    expect(() => env.DATABASE_URL).toThrowError(/DATABASE_URL/);
  });

  it('SKIP_ENV_VALIDATION=true のときは検証せず生の値を返す（CIビルド用）', async () => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('GITHUB_API_TOKEN', 'raw-token');
    const env = await importEnv();
    expect(env.GITHUB_API_TOKEN).toBe('raw-token');
    expect(() => env.AUTH_SECRET).not.toThrow();
  });
});
