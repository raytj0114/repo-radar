import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/digest/route';

const { runDailyDigestMock } = vi.hoisted(() => ({
  runDailyDigestMock: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: { CRON_SECRET: 'test-cron-secret' },
}));

vi.mock('@/lib/digest', () => ({
  runDailyDigest: runDailyDigestMock,
}));

function request(authorization?: string): Request {
  return new Request('http://localhost:3000/api/cron/digest', {
    headers: authorization ? { authorization } : {},
  });
}

const RUN_RESULT = {
  date: '2026-07-25',
  windows: [
    {
      date: '2026-07-25',
      digests: { created: 1, repaired: 0, unchanged: 0, kept: 0, noActivity: 0, failed: 0 },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  runDailyDigestMock.mockResolvedValue(RUN_RESULT);
});

describe('GET /api/cron/digest', () => {
  it('Authorizationヘッダが無ければ401で、何も実行しない', async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(runDailyDigestMock).not.toHaveBeenCalled();
  });

  it('シークレットが違えば401', async () => {
    const res = await GET(request('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(runDailyDigestMock).not.toHaveBeenCalled();
  });

  it('正しいシークレットなら朝刊の組み立てを実行し、結果をそのまま返す', async () => {
    const res = await GET(request('Bearer test-cron-secret'));
    expect(res.status).toBe(200);
    expect(runDailyDigestMock).toHaveBeenCalledTimes(1);
    expect(runDailyDigestMock.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(await res.json()).toEqual(RUN_RESULT);
  });
});
