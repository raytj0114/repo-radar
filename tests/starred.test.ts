import { beforeEach, describe, expect, it, vi } from 'vitest';
import starredFixture from './fixtures/github/starred.json';

const { findFirstMock, fetchUserLoginMock, fetchStarredMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  fetchUserLoginMock: vi.fn(),
  fetchStarredMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findFirst: findFirstMock } },
}));

vi.mock('@/lib/github/client', () => ({
  fetchUserLogin: fetchUserLoginMock,
  fetchStarredRepositories: fetchStarredMock,
}));

import { loadStarredForUser } from '@/lib/starred';

describe('loadStarredForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue({ providerAccountId: '583231' });
    fetchUserLoginMock.mockResolvedValue('octocat');
    fetchStarredMock.mockResolvedValue(starredFixture);
  });

  it('Account行 → login解決 → スター一覧の順に引き当てる', async () => {
    const result = await loadStarredForUser('user_1');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { userId: 'user_1', provider: 'github' },
      select: { providerAccountId: true },
    });
    expect(fetchUserLoginMock).toHaveBeenCalledWith('583231');
    expect(fetchStarredMock).toHaveBeenCalledWith('octocat');
    expect(result).toEqual({ status: 'ok', login: 'octocat', repos: starredFixture });
  });

  it('githubのAccount行が無ければno-accountを返し、GitHubへは行かない', async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(loadStarredForUser('user_1')).resolves.toEqual({ status: 'no-account' });
    expect(fetchUserLoginMock).not.toHaveBeenCalled();
    expect(fetchStarredMock).not.toHaveBeenCalled();
  });

  it('login解決が404ならlogin-missingを返し、スター一覧は取得しない', async () => {
    fetchUserLoginMock.mockResolvedValue(null);
    await expect(loadStarredForUser('user_1')).resolves.toEqual({ status: 'login-missing' });
    expect(fetchStarredMock).not.toHaveBeenCalled();
  });

  it('スター一覧が404でもlogin-missingに畳む', async () => {
    fetchStarredMock.mockResolvedValue(null);
    await expect(loadStarredForUser('user_1')).resolves.toEqual({ status: 'login-missing' });
  });

  it('GitHubの例外（レート上限等）は握りつぶさず伝播させる', async () => {
    const rateLimited = new Error('rate limited');
    fetchStarredMock.mockRejectedValue(rateLimited);
    await expect(loadStarredForUser('user_1')).rejects.toBe(rateLimited);
  });
});
