import { Suspense } from 'react';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { Colophon } from '@/components/features/paper/colophon';
import { EarWeather } from '@/components/features/paper/ear-weather';
import { Masthead } from '@/components/features/paper/masthead';
import { PaperBody } from '@/components/features/paper/paper-body';
import { PaperBodySkeleton } from '@/components/features/paper/paper-skeleton';
import { RadioGuide } from '@/components/features/paper/radio-guide';
import styles from '@/components/features/paper/paper.module.css';
import { paperDateFor } from '@/lib/paper';

// トップは「日刊 RepoRadar」そのものなので、テンプレート（%s | RepoRadar）を使わない
export const metadata: Metadata = {
  title: { absolute: '日刊 RepoRadar' },
};

/**
 * 一面（Issue #31）: docs/mocks/02-broadsheet.html を実装した新聞紙面。
 * 題字・日付行・奥付（同期計算のみ）をシェルとして即時送出し、
 * GitHub/DBに触れる本文はSuspense境界の内側で後追いストリーミングする（Issue #5 の構造を継承）。
 *
 * ここでストリーミングしてよいのは、この面が**同一ページのServer Actionを持たない**ため
 * （ログアウトは遷移する）。境界と同一ページactionが同居すると、action応答がクライアントへ
 * 届かずUIがpendingで固まる（Issue #47 の実測。`docs/ARCHITECTURE.md` のレンダリング制約）。
 * この面に操作を足すときは、その制約に触れないか必ず確かめること
 */
export default async function FrontPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const paper = paperDateFor(new Date());

  return (
    <main className={styles.backdrop}>
      <div className={styles.paper}>
        <Masthead
          paper={paper}
          weatherEar={
            <Suspense
              fallback={
                <span role="status" aria-busy="true" aria-label="観測中">
                  本日のAPI残量
                  <br />─
                </span>
              }
            >
              <EarWeather />
            </Suspense>
          }
        />
        <Suspense fallback={<PaperBodySkeleton />}>
          <PaperBody userId={session.user.id} paper={paper} />
        </Suspense>
        {/* ラテ欄は取得ゼロの同期部品なので、Suspenseの外＝シェルとして即時送出する */}
        <section className={styles.section}>
          <RadioGuide />
        </section>
        <Colophon userName={session.user.name} issueNumber={paper.issueNumber} current="front" />
      </div>
    </main>
  );
}
