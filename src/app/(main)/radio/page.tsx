import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { RadioSet } from '@/components/features/radio/radio-set';
import styles from '@/components/features/radio/radio.module.css';
import { digestEntriesSchema } from '@/lib/digest';
import { dailyDigestKey } from '@/lib/github/cache-key';
import { fetchRateLimit } from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import type { RateLimitSnapshot } from '@/lib/github/schemas';
import { loadLatestSignals } from '@/lib/latest-signals';
import { listSilent, paperDateFor, pickFrontPage, weatherFor, type PaperDate } from '@/lib/paper';
import { prisma } from '@/lib/prisma';
import {
  buildOutageStations,
  buildStations,
  type RadioStation,
  type SilenceObservation,
} from '@/lib/radio';

// 深夜放送は紙面の続きではなく別の機械なので、題字のテンプレート（%s | RepoRadar）を使わない
export const metadata: Metadata = {
  title: { absolute: 'JORR 深夜放送' },
};

/**
 * 当夜の番組表を組む。**この関数は決して reject しない**。
 * 返り値のPromiseはRSC境界を越えてclient componentへ渡るため、rejectさせると
 * 「誰も待っていない例外」になる。取得に失敗したら休止告知の放送に倒す（放送は落ちない）。
 *
 * AI呼び出しはゼロ: 素材は当日の DailyDigest.entries（朝刊）と、
 * 紙面が既に使っている観測値（お気に入りの最新リリース・API残量）の読み取りだけ
 */
async function loadPrograms(userId: string, paper: PaperDate): Promise<RadioStation[]> {
  try {
    const now = new Date();
    const digestDate = new Date(`${paper.digestDay}T00:00:00.000Z`);

    // 互いに独立な取得は同時に投げる（docs/ARCHITECTURE.md「依存関係の無い取得は直列にawaitしない」）
    const [digestRow, favorites, rateLimitSettled] = await Promise.all([
      prisma.dailyDigest.findUnique({
        where: { cacheKey: dailyDigestKey(digestDate, userId) },
        select: { entries: true },
      }),
      prisma.favoriteRepo.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      settle(fetchRateLimit()),
    ]);

    let rateLimit: RateLimitSnapshot | null = null;
    if (rateLimitSettled.status === 'fulfilled') {
      rateLimit = rateLimitSettled.value;
    } else {
      // レート上限そのものも含め、観測できなければ気象通報が「観測できません」と報じる
      console.error('[radio] rate limit fetch failed:', rateLimitSettled.reason);
    }
    const weather = rateLimit ? weatherFor(rateLimit) : null;

    // 旧形式・壊れた行は空として扱う（第一放送は休載を告げる）
    const parsed = digestEntriesSchema.safeParse(digestRow?.entries);
    const entries = parsed.success ? parsed.data : [];

    // 取得の欠落は必ず放送へ伝える。観測できなかったことを「沈黙はない」と言い換えない
    // （紙面の沈黙欄が観測休止に倒れるのと同じ縮退。skills/github-api-patterns「黙って空を返さない」）
    const { signals, rateLimited, failedCount } = await loadLatestSignals(favorites);
    const observation: SilenceObservation = rateLimited
      ? 'rate-limited'
      : failedCount > 0
        ? 'partial'
        : 'complete';

    return buildStations(
      { paper, entries, front: pickFrontPage(entries), weather, rateLimit },
      { paper, silent: listSilent(signals, now), observation, weather, rateLimit }
    );
  } catch (error) {
    console.error('[radio] program assembly failed:', error);
    return buildOutageStations();
  }
}

/**
 * 深夜放送 JORR（Issue #32）: docs/mocks/04-night-radio.html を実装した受信機。
 * 番組表も原稿も進捗も画面には出さない。放送は音にしか存在しない。
 *
 * 原稿の取得は **await しない**。筐体（ダイヤル・計器・ツマミ）を先に届け、
 * 番組はPromiseのままclient componentへ渡して後から解決させる。
 * 電源を入れるまで音は鳴らないので、原稿の到着が描画を待たせる理由がない
 */
export default async function RadioPage() {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const paper = paperDateFor(new Date());

  return (
    <main className={styles.stage}>
      <RadioSet programs={loadPrograms(session.user.id, paper)} />
    </main>
  );
}
