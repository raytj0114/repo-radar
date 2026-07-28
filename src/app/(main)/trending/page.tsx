import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import clsx from 'clsx';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { searchTrendingRepositories } from '@/lib/github/client';
import { RATE_LIMITED, settle, unwrapSettled } from '@/lib/github/concurrent';
import type { SearchRepositoriesResult } from '@/lib/github/schemas';
import { FavoriteToggle } from '@/components/features/favorites/favorite-toggle';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { formatCompactNumber } from '@/lib/format';

export const metadata: Metadata = {
  title: 'トレンド',
};

const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Rust', 'Go'] as const;
const TREND_WINDOW_DAYS = 30;

// リクエスト時点を基準に検索窓の起点を返す（動的ページなのでレンダーごとの評価で正しい）
function trendWindowStart(): Date {
  return new Date(Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ language?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const { language: rawLanguage } = await searchParams;
  const language = LANGUAGES.find((l) => l === rawLanguage);

  const createdAfter = trendWindowStart();

  // GitHub検索とお気に入りの取得は互いに独立なので同時に投げる（Issue #6）。
  // 検索が失敗しても favorites の取得を巻き込まないよう settle で包む
  const [searchSettled, favorites] = await Promise.all([
    settle(searchTrendingRepositories({ language, createdAfter })),
    prisma.favoriteRepo.findMany({
      where: { userId: session.user.id },
      select: { owner: true, name: true },
    }),
  ]);
  const favoriteSet = new Set(favorites.map((f) => `${f.owner}/${f.name}`));

  const searchResult = unwrapSettled(searchSettled);
  const rateLimited = searchResult === RATE_LIMITED;
  const result: SearchRepositoriesResult | null = rateLimited ? null : searchResult;

  return (
    <main>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">トレンド</h1>
      <p className="mb-6 text-sm text-gray-500">
        直近{TREND_WINDOW_DAYS}日に作成されたリポジトリのスターランキング
      </p>

      <nav aria-label="言語フィルタ" className="mb-6 flex flex-wrap gap-2">
        <LanguageChip href="/trending" label="すべて" active={!language} />
        {LANGUAGES.map((l) => (
          <LanguageChip
            key={l}
            href={`/trending?language=${l}`}
            label={l}
            active={language === l}
          />
        ))}
      </nav>

      {rateLimited ? (
        <Notice message="GitHub APIのレート上限に達したため、トレンドを取得できませんでした。しばらくすると回復します。" />
      ) : result === null || result.items.length === 0 ? (
        <EmptyState title="該当するリポジトリが見つかりませんでした" />
      ) : (
        <ol className="divide-y divide-gray-100">
          {result.items.map((repo, index) => (
            <li key={repo.id} className="flex items-center gap-3 py-4">
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-400">
                {index + 1}
              </span>
              <Image
                src={repo.owner.avatar_url}
                alt=""
                width={32}
                height={32}
                className="rounded-full"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <Link
                    href={`/repos/${repo.owner.login}/${repo.name}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {repo.full_name}
                  </Link>
                  {repo.language && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {repo.language}
                    </span>
                  )}
                </div>
                {repo.description && (
                  <p className="mt-0.5 truncate text-sm text-gray-500">{repo.description}</p>
                )}
              </div>
              <span className="shrink-0 text-sm tabular-nums text-gray-500">
                ★ {formatCompactNumber(repo.stargazers_count)}
              </span>
              <FavoriteToggle
                owner={repo.owner.login}
                name={repo.name}
                avatarUrl={repo.owner.avatar_url}
                isFavorite={favoriteSet.has(`${repo.owner.login}/${repo.name}`)}
              />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function LanguageChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={clsx(
        'rounded-full px-3 py-1 text-sm transition-colors',
        active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      )}
    >
      {label}
    </Link>
  );
}
