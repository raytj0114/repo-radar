import type { Metadata } from 'next';
import Link from 'next/link';
import { DigestEntryList } from '@/components/features/digest/digest-entry-list';
import { Colophon } from '@/components/features/paper/colophon';
import { MenMasthead } from '@/components/features/paper/men-masthead';
import paperStyles from '@/components/features/paper/paper.module.css';
import { auth } from '@/lib/auth';
import { digestEntriesSchema, type DigestEntry } from '@/lib/digest';
import { formatDateKanjiJa, toKanjiDigits } from '@/lib/format';
import { paperDateFor, paperDateForDigestDay } from '@/lib/paper';
import { prisma } from '@/lib/prisma';

// 縮刷版も紙面の一部なので、テンプレート（%s | RepoRadar）を使わない
export const metadata: Metadata = {
  title: { absolute: '縮刷版｜日刊 RepoRadar' },
};

const DIGEST_HISTORY_LIMIT = 30;

/** entries（朝刊形式）を検証して取り出す。旧形式・不正な形は null（contentのテキスト表示へ） */
function parseEntries(entries: unknown): DigestEntry[] | null {
  if (entries === null || entries === undefined) return null;
  const parsed = digestEntriesSchema.safeParse(entries);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

/**
 * 縮刷版（Issue #41）: 過去号のアーカイブ組版。各号を朱の縦帯（第N号）で綴じる。
 * 号の日付は**発行朝**（帰属日の翌朝6:00 JST = `paperDateForDigestDay`）で刷る。
 * 帰属日（DB `date` 列）の直刷りは一面の日付と1日ずれて見えていた（#41で修正）。
 *
 * 同一ページactionは無いのでストリーミング可の面だが、本文はDB1クエリのみで
 * シェル先行の恩恵が無いため、Suspense境界を持つのは一面だけに保つ（ユーザー裁定）
 */
export default async function DigestPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const paper = paperDateFor(new Date());
  const digests = await prisma.dailyDigest.findMany({
    where: { userId: session.user.id },
    orderBy: { date: 'desc' },
    take: DIGEST_HISTORY_LIMIT,
  });

  // 「本日分」= 今日の朝刊の帰属日（= paper.digestDay。直近21:00 UTCの窓）。素朴なUTC日付比較だと
  // 9:00 JST以降、届いているのに未生成と誤表示していた（#30持ち越しのJST意味論。Issue #31で裁定）
  const hasToday = digests.some(
    (digest) => digest.date.toISOString().slice(0, 10) === paper.digestDay
  );

  return (
    <main className={paperStyles.backdrop}>
      <div className={paperStyles.paper}>
        <MenMasthead paper={paper} title="縮刷版" edition="保存版・直近三十号" />

        {digests.length === 0 ? (
          <section className={`${paperStyles.section} ${paperStyles.noRule}`}>
            <p className={paperStyles.kyusai}>
              縮刷版に綴じる号はまだ無い。購読銘柄に動きのあった朝、最初の一号が刷られる。
            </p>
            <p className={paperStyles.teaser}>
              <Link href="/trending">トレンド面で銘柄を探す</Link>
              <small className={paperStyles.repoDesc}>
                購読を登録すると、翌朝から朝刊が組まれる。
              </small>
            </p>
          </section>
        ) : (
          <>
            {!hasToday && (
              <section className={`${paperStyles.section} ${paperStyles.noRule}`}>
                <p className={paperStyles.kyusai}>本日の朝刊は組版中（毎朝六時締）。</p>
              </section>
            )}
            {digests.map((digest, index) => {
              const issue = paperDateForDigestDay(digest.date.toISOString().slice(0, 10));
              const entries = parseEntries(digest.entries);
              const noRule = hasToday && index === 0;
              return (
                <section
                  key={digest.id}
                  className={`${paperStyles.section} ${noRule ? paperStyles.noRule : ''}`}
                >
                  <article className={paperStyles.columnBox}>
                    <div className={paperStyles.tate} aria-hidden="true">
                      第{toKanjiDigits(issue.issueNumber)}号
                    </div>
                    <div className={paperStyles.columnBody}>
                      <h2 className={paperStyles.smallHd}>
                        {formatDateKanjiJa(issue.issuedAtIso)}
                        <small>第{toKanjiDigits(issue.issueNumber)}号（朝六時発行）</small>
                      </h2>
                      {entries ? (
                        <DigestEntryList entries={entries} />
                      ) : (
                        <p className={paperStyles.preLine}>{digest.content}</p>
                      )}
                    </div>
                  </article>
                </section>
              );
            })}
            <p className={paperStyles.nextNote}>（保存は直近三十号）</p>
          </>
        )}

        <Colophon userName={session.user.name} issueNumber={paper.issueNumber} current="digest" />
      </div>
    </main>
  );
}
