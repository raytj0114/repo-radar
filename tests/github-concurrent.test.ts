import { describe, expect, it, vi } from 'vitest';
import { GitHubAPIError, GitHubRateLimitError } from '@/lib/github/client';
import { RATE_LIMITED, settle, unwrapSettled } from '@/lib/github/concurrent';

// client.ts は env を読むため、実トークンに依存しないようモックする
vi.mock('@/lib/env', () => ({ env: { GITHUB_API_TOKEN: 'test-token' } }));

describe('settle', () => {
  it('成功したPromiseを fulfilled として値のまま返す', async () => {
    await expect(settle(Promise.resolve(42))).resolves.toEqual({
      status: 'fulfilled',
      value: 42,
    });
  });

  it('失敗したPromiseを rejected として値に変換する（呼び出し元では例外にならない）', async () => {
    const error = new Error('boom');
    await expect(settle(Promise.reject(error))).resolves.toEqual({
      status: 'rejected',
      reason: error,
    });
  });

  it('Promise.all に混ぜても他の要素を巻き込んで落とさない', async () => {
    const [failed, value] = await Promise.all([
      settle(Promise.reject(new Error('boom'))),
      Promise.resolve('ok'),
    ]);

    expect(failed.status).toBe('rejected');
    expect(value).toBe('ok');
  });
});

describe('unwrapSettled', () => {
  it('fulfilled なら値を取り出す', () => {
    expect(unwrapSettled({ status: 'fulfilled', value: 'ok' })).toBe('ok');
  });

  it('値がnull（404）でもそのまま返し、レート上限の番兵とは区別できる', () => {
    expect(unwrapSettled({ status: 'fulfilled', value: null })).toBeNull();
    expect(unwrapSettled({ status: 'fulfilled', value: null })).not.toBe(RATE_LIMITED);
  });

  it('レート上限は番兵に変換する（縮退表示のため）', () => {
    expect(unwrapSettled({ status: 'rejected', reason: new GitHubRateLimitError() })).toBe(
      RATE_LIMITED
    );
  });

  it('レート上限以外のGitHubエラーは投げ直す（握りつぶさない）', () => {
    const error = new GitHubAPIError(502, 'GitHubのレスポンスが想定外の形式でした');
    expect(() => unwrapSettled({ status: 'rejected', reason: error })).toThrow(error);
  });

  it('GitHub由来でない例外も投げ直す', () => {
    const error = new Error('boom');
    expect(() => unwrapSettled({ status: 'rejected', reason: error })).toThrow(error);
  });
});
