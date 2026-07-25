import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchReleases, GitHubRateLimitError } from '@/lib/github/client';
import {
  ReleaseTimeline,
  type TimelineEntry,
} from '@/components/features/releases/release-timeline';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';

// 1リポジトリあたりタイムラインに載せる最大リリース数と、全体の表示上限
const RELEASES_PER_REPO = 5;
const TIMELINE_LIMIT = 30;

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const favorites = await prisma.favoriteRepo.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });

  if (favorites.length === 0) {
    return (
      <main>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">ダッシュボード</h1>
        <EmptyState
          title="お気に入りのリポジトリがまだありません"
          description="トレンドからリポジトリをお気に入りに追加すると、最新リリースがここに時系列で表示されます。"
          action={
            <Link
              href="/trending"
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              トレンドを見る
            </Link>
          }
        />
      </main>
    );
  }

  const settled = await Promise.allSettled(
    favorites.map(async (favorite) => ({
      favorite,
      releases: await fetchReleases(favorite.owner, favorite.name),
    }))
  );

  const entries: TimelineEntry[] = [];
  let rateLimited = false;
  const failedRepos: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      if (result.reason instanceof GitHubRateLimitError) {
        rateLimited = true;
      } else {
        failedRepos.push(favorites[index].fullName);
      }
      return;
    }
    const { favorite, releases } = result.value;
    // releases === null はリポジトリ消滅・改名（404）。タイムラインからは黙って除く
    for (const release of releases?.slice(0, RELEASES_PER_REPO) ?? []) {
      entries.push({
        owner: favorite.owner,
        repoName: favorite.name,
        fullName: favorite.fullName,
        avatarUrl: favorite.avatarUrl,
        release,
      });
    }
  });

  entries.sort((a, b) =>
    (b.release.published_at ?? '').localeCompare(a.release.published_at ?? '')
  );
  const visible = entries.slice(0, TIMELINE_LIMIT);

  return (
    <main>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">ダッシュボード</h1>
      <div className="flex flex-col gap-4">
        {rateLimited && (
          <Notice message="GitHub APIのレート上限に達したため、一部の最新情報を取得できませんでした。しばらくすると回復します。" />
        )}
        {failedRepos.length > 0 && (
          <Notice message={`次のリポジトリの取得に失敗しました: ${failedRepos.join(', ')}`} />
        )}
        {visible.length === 0 ? (
          <EmptyState
            title="表示できるリリースがありません"
            description="お気に入りのリポジトリにまだリリースが無いか、取得できませんでした。"
          />
        ) : (
          <ReleaseTimeline entries={visible} />
        )}
      </div>
    </main>
  );
}
