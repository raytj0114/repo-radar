import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { Release } from '@/lib/github/schemas';
import { formatDateJa } from '@/lib/format';

export type TimelineEntry = {
  owner: string;
  repoName: string;
  fullName: string;
  avatarUrl: string | null;
  release: Release;
};

export function ReleaseTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="divide-y divide-gray-100">
      {entries.map(({ owner, repoName, fullName, avatarUrl, release }) => (
        <li key={`${fullName}@${release.id}`} className="flex items-start gap-3 py-4">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" width={32} height={32} className="mt-0.5 rounded-full" />
          ) : (
            <div className="mt-0.5 h-8 w-8 rounded-full bg-gray-200" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/repos/${owner}/${repoName}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {fullName}
              </Link>
              <span className="truncate text-sm text-gray-700">
                {release.name ?? release.tag_name}
              </span>
              {release.prerelease && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                  prerelease
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {release.tag_name}
              {release.published_at && ` ・ ${formatDateJa(release.published_at)}`}
            </p>
          </div>
          <a
            href={release.html_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHubで開く"
            className="mt-1 text-gray-400 hover:text-gray-700"
          >
            <ExternalLink size={16} />
          </a>
        </li>
      ))}
    </ol>
  );
}
