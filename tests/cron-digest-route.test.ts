import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/digest/route';

const { favoritesFindManyMock, generateDailyDigestMock } = vi.hoisted(() => ({
  favoritesFindManyMock: vi.fn(),
  generateDailyDigestMock: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { favoriteRepo: { findMany: favoritesFindManyMock } },
}));

vi.mock('@/lib/digest', () => ({
  generateDailyDigest: generateDailyDigestMock,
}));

function request(authorization?: string): Request {
  return new Request('http://localhost:3000/api/cron/digest', {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  favoritesFindManyMock.mockResolvedValue([{ userId: 'user_1' }, { userId: 'user_2' }]);
  generateDailyDigestMock.mockResolvedValue('generated');
});

describe('GET /api/cron/digest', () => {
  it('Authorizationヘッダが無ければ401で、何も生成しない', async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(generateDailyDigestMock).not.toHaveBeenCalled();
  });

  it('シークレットが違えば401', async () => {
    const res = await GET(request('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(generateDailyDigestMock).not.toHaveBeenCalled();
  });

  it('正しいシークレットならお気に入り保有ユーザーごとに生成する', async () => {
    const res = await GET(request('Bearer test-cron-secret'));
    expect(res.status).toBe(200);
    expect(generateDailyDigestMock).toHaveBeenCalledTimes(2);
    const body = await res.json();
    expect(body.users).toBe(2);
    expect(body.counts.generated).toBe(2);
  });

  it('一部ユーザーの失敗は他ユーザーの生成を止めない', async () => {
    generateDailyDigestMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('generated');
    const res = await GET(request('Bearer test-cron-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.failed).toBe(1);
    expect(body.counts.generated).toBe(1);
  });
});
