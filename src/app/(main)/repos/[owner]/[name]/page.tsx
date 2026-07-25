import Image from 'next/image';
import type { Metadata } from 'next';
import { CircleDot, GitFork, Star } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchReleases, fetchRepository, GitHubRateLimitError } from '@/lib/github/client';
import type { Release } from '@/lib/github/schemas';
import { favoriteTargetSchema } from '@/lib/favorite-input';
import { FavoriteToggle } from '@/components/features/favorites/favorite-toggle';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { formatCompactNumber, formatDateJa } from '@/lib/format';

type Params = Promise<{ owner: string; name: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `${owner}/${name}` };
}

export default async function RepoDetailPage({ params }: { params: Params }) {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  // URLパラメータはGitHubの命名規則で検証してからAPIへ渡す
  const parsedParams = favoriteTargetSchema.safeParse(await params);
  if (!parsedParams.success) {
    return <RepoNotFound />;
  }
  const { owner, name } = parsedParams.data;

  let repo = null;
  let releases: Release[] | null = null;
  let rateLimited = false;
  try {
    repo = await fetchRepository(owner, name);
    releases = repo ? await fetchReleases(owner, name) : null;
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      rateLimited = true;
    } else {
      throw error;
    }
  }

  if (rateLimited) {
    return (
      <main>
        <Notice message="GitHub APIのレート上限に達したため、リポジトリ情報を取得できませんでした。しばらくすると回復します。" />
      </main>
    );
  }

  if (!repo) {
    return <RepoNotFound />;
  }

  const favorite = await prisma.favoriteRepo.findUnique({
    where: { userId_owner_name: { userId: session.user.id, owner, name } },
    select: { id: true },
  });

  return (
    <main>
      <header className="flex items-start gap-4">
        <Image src={repo.owner.avatar_url} alt="" width={48} height={48} className="rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h1 className="truncate text-2xl font-bold tracking-tight">
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {repo.full_name}
              </a>
            </h1>
            <FavoriteToggle
              owner={repo.owner.login}
              name={repo.name}
              avatarUrl={repo.owner.avatar_url}
              isFavorite={favorite !== null}
            />
          </div>
          {repo.description && <p className="mt-1 text-sm text-gray-600">{repo.description}</p>}
          <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <MetaItem
              icon={<Star size={14} />}
              label="スター"
              value={formatCompactNumber(repo.stargazers_count)}
            />
            <MetaItem
              icon={<GitFork size={14} />}
              label="フォーク"
              value={formatCompactNumber(repo.forks_count)}
            />
            <MetaItem
              icon={<CircleDot size={14} />}
              label="Issue"
              value={formatCompactNumber(repo.open_issues_count)}
            />
            {repo.language && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {repo.language}
              </span>
            )}
          </dl>
        </div>
      </header>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-bold">リリース履歴</h2>
        {!releases || releases.length === 0 ? (
          <EmptyState title="リリースがありません" />
        ) : (
          <ol className="flex flex-col gap-4">
            {releases.map((release) => (
              <li key={release.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {release.name ?? release.tag_name}
                  </a>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {release.tag_name}
                  </span>
                  {release.prerelease && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                      prerelease
                    </span>
                  )}
                  {release.published_at && (
                    <span className="ml-auto text-xs text-gray-500">
                      {formatDateJa(release.published_at)}
                    </span>
                  )}
                </div>
                {release.body && (
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-gray-600">
                    {release.body}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <dt className="sr-only">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function RepoNotFound() {
  return (
    <main>
      <EmptyState
        title="リポジトリが見つかりません"
        description="削除・改名されたか、URLが誤っている可能性があります。"
      />
    </main>
  );
}
