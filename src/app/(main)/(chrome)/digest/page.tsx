import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DigestEntryList } from '@/components/features/digest/digest-entry-list';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { digestEntriesSchema, type DigestEntry } from '@/lib/digest';
import { latestDigestDay } from '@/lib/digest-window';
import { formatDateJa } from '@/lib/format';

export const metadata: Metadata = {
  title: 'デイリーダイジェスト',
};

const DIGEST_HISTORY_LIMIT = 30;

/** entries（朝刊形式）を検証して取り出す。旧形式・不正な形は null（contentのテキスト表示へ） */
function parseEntries(entries: unknown): DigestEntry[] | null {
  if (entries === null || entries === undefined) return null;
  const parsed = digestEntriesSchema.safeParse(entries);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

export default async function DigestPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const digests = await prisma.dailyDigest.findMany({
    where: { userId: session.user.id },
    orderBy: { date: 'desc' },
    take: DIGEST_HISTORY_LIMIT,
  });

  // 「本日分」= 今日の朝刊の帰属日（直近21:00 UTCの窓）。素朴なUTC日付比較だと
  // 9:00 JST以降、届いているのに未生成と誤表示していた（#30持ち越しのJST意味論。Issue #31で裁定）
  const expectedDay = latestDigestDay(new Date());
  const hasToday = digests.some((digest) => digest.date.toISOString().slice(0, 10) === expectedDay);

  return (
    <main>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">デイリーダイジェスト</h1>
      <p className="mb-6 text-sm text-gray-500">
        お気に入りリポジトリの1日の動きを、AI要約付きの朝刊にまとめます（毎日自動生成）
      </p>

      {digests.length === 0 ? (
        <EmptyState
          title="ダイジェストはまだありません"
          description="お気に入りのリポジトリに新しいリリースがあった日に、自動でダイジェストが生成されます。"
          action={
            <Link
              href="/trending"
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              トレンドからお気に入りを追加
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {!hasToday && (
            <Notice message="本日分のダイジェストはまだ生成されていません（毎日 6:00 JST に自動生成されます）。" />
          )}
          {digests.map((digest) => {
            const entries = parseEntries(digest.entries);
            return (
              <article key={digest.id} className="rounded-lg border border-gray-200 p-4">
                <h2 className="mb-2 flex items-center gap-1.5 font-bold">
                  <Sparkles size={14} className="text-indigo-500" />
                  {formatDateJa(digest.date.toISOString())}
                </h2>
                {entries ? (
                  <DigestEntryList entries={entries} />
                ) : (
                  <p className="whitespace-pre-line text-sm text-gray-800">{digest.content}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
