import { GitHubRateLimitError, searchRepositoriesByName } from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import type { SearchRepositoriesResult } from '@/lib/github/schemas';
import { paperRepoKey } from '@/lib/paper';
import { prisma } from '@/lib/prisma';
import { loadStarredForUser, type StarredLookup } from '@/lib/starred';
import paperStyles from '@/components/features/paper/paper.module.css';
import { LedgerTable } from './ledger-table';
import { RepoSearch, type SearchState } from './repo-search';
import { StarLedger, type StarLedgerState } from './star-ledger';

/** 検索語の検証結果（ページ側で `repoSearchQuerySchema` を通した後の姿） */
export type QueryState = { kind: 'none' } | { kind: 'invalid' } | { kind: 'valid'; term: string };

/**
 * 購読面の本文。縮退の方針は紙面（paper-body）と同じ「面は落ちない」:
 * GitHub系の失敗は欄単位で休載枠に落とし、台帳（DB）と他の欄は生かす。
 * レート枠はプール別（core=星取帳 / search=銘柄検索）なので、縮退も欄別に起きる
 */
export async function SubscriptionBody({
  userId,
  queryState,
  showStarred,
}: {
  userId: string;
  queryState: QueryState;
  showStarred: boolean;
}) {
  // 互いに独立な取得は同時に投げる。検索・星取はクエリ/開帳時のみ（既定はGitHub呼び出しゼロ）
  const [favorites, searchSettled, starredSettled] = await Promise.all([
    prisma.favoriteRepo.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { fullName: 'asc' }],
      select: { owner: true, name: true, fullName: true, avatarUrl: true, createdAt: true },
    }),
    queryState.kind === 'valid' ? settle(searchRepositoriesByName(queryState.term)) : null,
    showStarred ? settle(loadStarredForUser(userId)) : null,
  ]);

  const subscribedKeys = new Set(favorites.map((f) => paperRepoKey(f.owner, f.name)));

  const searchState = searchStateOf(queryState, searchSettled);
  const starLedgerState = starLedgerStateOf(starredSettled, subscribedKeys, {
    openHref:
      queryState.kind === 'valid'
        ? `/favorites?q=${encodeURIComponent(queryState.term)}&star=1`
        : '/favorites?star=1',
  });

  return (
    <>
      <section className={`${paperStyles.section} ${paperStyles.noRule}`}>
        <LedgerTable rows={favorites} />
      </section>
      <section className={paperStyles.section}>
        <RepoSearch
          state={searchState}
          defaultTerm={queryState.kind === 'valid' ? queryState.term : ''}
          keepStarOpen={showStarred}
          subscribedKeys={subscribedKeys}
        />
      </section>
      <section className={paperStyles.section}>
        <StarLedger state={starLedgerState} />
      </section>
    </>
  );
}

function searchStateOf(
  queryState: QueryState,
  settled: PromiseSettledResult<SearchRepositoriesResult> | null
): SearchState {
  if (queryState.kind === 'invalid') return { kind: 'invalid' };
  if (settled === null) return { kind: 'idle' };
  if (settled.status === 'fulfilled') return { kind: 'ok', result: settled.value };
  if (settled.reason instanceof GitHubRateLimitError) return { kind: 'rate-limited' };
  console.error('[favorites] 銘柄検索に失敗:', settled.reason);
  return { kind: 'failed' };
}

function starLedgerStateOf(
  settled: PromiseSettledResult<StarredLookup> | null,
  subscribedKeys: ReadonlySet<string>,
  { openHref }: { openHref: string }
): StarLedgerState {
  if (settled === null) return { kind: 'closed', openHref };
  if (settled.status === 'rejected') {
    if (settled.reason instanceof GitHubRateLimitError) return { kind: 'rate-limited' };
    console.error('[favorites] スター一覧の取得に失敗:', settled.reason);
    return { kind: 'failed' };
  }
  const lookup = settled.value;
  if (lookup.status !== 'ok') return { kind: lookup.status };
  return {
    kind: 'ok',
    rows: lookup.repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      description: repo.description,
      subscribed: subscribedKeys.has(paperRepoKey(repo.owner.login, repo.name)),
    })),
  };
}
