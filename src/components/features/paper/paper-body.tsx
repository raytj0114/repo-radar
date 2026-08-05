import { digestEntriesSchema, type DigestEntry } from '@/lib/digest';
import { dailyDigestKey, releaseSummaryKey } from '@/lib/github/cache-key';
import {
  fetchRateLimit,
  GitHubRateLimitError,
  searchTrendingRepositories,
} from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import type { RateLimitSnapshot } from '@/lib/github/schemas';
import { loadLatestSignals } from '@/lib/latest-signals';
import {
  composeBriefs,
  composeMarket,
  listSilent,
  pickFrontPage,
  MARKET_WINDOW_DAYS,
  type MarketRow,
  type PaperDate,
  type StarPoint,
} from '@/lib/paper';
import { prisma } from '@/lib/prisma';
import { loadStarHistories } from '@/lib/star-snapshot';
import { BriefList } from './brief-list';
import { LeadArticle, LeadHoliday, SecondArticle } from './lead-article';
import { MarketTable } from './market-table';
import { SilenceTable } from './silence-table';
import { WeatherBox } from './weather-box';
import styles from './paper.module.css';

/** 相場欄の行数（紙面の組みに合わせる）。観測窓は採取と共有する `MARKET_WINDOW_DAYS` */
const MARKET_ROW_LIMIT = 6;

/** entries（朝刊形式）を検証して取り出す。旧形式・不正な形は空（一面は休載になる） */
function parseEntries(entries: unknown): DigestEntry[] {
  const parsed = digestEntriesSchema.safeParse(entries);
  return parsed.success ? parsed.data : [];
}

/**
 * 紙面の本文（一面・二番手・短信・相場・天気・沈黙）。遅い処理はすべてこの中に閉じ、
 * シェル（題字・日付行）の即時送出を妨げない。
 *
 * 縮退の方針: 紙面は「落ちない」。取得に失敗した欄は休載・観測休止の枠で報じ、
 * 他の欄は生かす（トレンド面のようにエラー境界へ全面で倒さない）。
 * レート枠はプール別（core=短信・沈黙 / search=相場）なので、縮退も欄別に起きる
 */
export async function PaperBody({ userId, paper }: { userId: string; paper: PaperDate }) {
  const now = new Date();
  const digestDate = new Date(`${paper.digestDay}T00:00:00.000Z`);

  // 互いに独立な取得は同時に投げる（docs/ARCHITECTURE.md「依存関係の無い取得は直列にawaitしない」）
  const [favorites, digestRow, marketSettled, weatherSettled] = await Promise.all([
    prisma.favoriteRepo.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.dailyDigest.findUnique({
      where: { cacheKey: dailyDigestKey(digestDate, userId) },
      select: { entries: true },
    }),
    settle(
      searchTrendingRepositories({
        createdAfter: new Date(now.getTime() - MARKET_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        perPage: MARKET_ROW_LIMIT,
      })
    ),
    settle(fetchRateLimit()),
  ]);

  const entries = digestRow ? parseEntries(digestRow.entries) : [];
  const { lead, second, featuredRepoKeys } = pickFrontPage(entries);

  const trendingItems = marketSettled.status === 'fulfilled' ? marketSettled.value.items : [];

  // お気に入り全銘柄の最新信号（旧タイムラインの取得を吸収。1リポジトリ1リクエスト）。
  // 深夜放送（/radio）の気象通報と同じ取得口を使い、fetchキャッシュを共有する。
  // 星数の履歴（相場欄の前日比。Issue #40）はDBのみを見るので、GitHub取得と一緒に待つ
  const [{ signals, rateLimited, failedCount }, historiesSettled] = await Promise.all([
    loadLatestSignals(favorites),
    settle(
      loadStarHistories(
        trendingItems.map((item) => item.full_name),
        paper.digestDay
      )
    ),
  ]);

  // 短信の1行目に使う共有要約（キャッシュの読み取りのみ。ここからAI生成は絶対に発火させない）
  const summaryKeys = signals.map((signal) =>
    releaseSummaryKey(signal.owner, signal.name, signal.tagName)
  );
  const summaryRows =
    summaryKeys.length > 0
      ? await prisma.releaseSummary.findMany({
          where: { cacheKey: { in: summaryKeys } },
          select: { cacheKey: true, summary: true },
        })
      : [];
  const firstLineByKey = new Map(
    summaryRows.map((row) => [row.cacheKey, row.summary.split('\n')[0] ?? null])
  );
  const signalsWithSummary = signals.map((signal) => ({
    ...signal,
    summaryFirstLine:
      firstLineByKey.get(releaseSummaryKey(signal.owner, signal.name, signal.tagName)) ?? null,
  }));

  const briefs = composeBriefs(signalsWithSummary, featuredRepoKeys, now);
  const silent = listSilent(signalsWithSummary, now);

  // 星数の履歴が引けなくても相場欄は落とさない（全銘柄が日割へ縮退する。捏造はしない）
  let histories: Map<string, StarPoint[]> = new Map();
  if (historiesSettled.status === 'fulfilled') {
    histories = historiesSettled.value;
  } else {
    console.error('[paper] star snapshot query failed:', historiesSettled.reason);
  }

  // 相場（searchプール）: レート上限はその旨を報じ、他の失敗はデータリンク不通として休載
  let market: MarketRow[] | null = null;
  let marketRateLimited = false;
  if (marketSettled.status === 'fulfilled') {
    market = composeMarket(trendingItems, histories, paper.digestDay, now);
  } else if (marketSettled.reason instanceof GitHubRateLimitError) {
    marketRateLimited = true;
  } else {
    console.error('[paper] trending fetch failed:', marketSettled.reason);
  }

  let weather: RateLimitSnapshot | null = null;
  if (weatherSettled.status === 'fulfilled') {
    weather = weatherSettled.value;
  } else {
    console.error('[paper] rate limit fetch failed:', weatherSettled.reason);
  }

  return (
    <>
      <section className={`${styles.section} ${styles.noRule}`}>
        {lead ? <LeadArticle entry={lead} /> : <LeadHoliday hasFavorites={favorites.length > 0} />}
      </section>

      <section className={styles.section}>
        {second ? (
          <div className={`${styles.row} ${styles.mid}`}>
            <div>
              <SecondArticle entry={second} />
            </div>
            <div>
              <BriefList
                lines={briefs}
                hasFavorites={favorites.length > 0}
                rateLimited={rateLimited}
                failedCount={failedCount}
              />
            </div>
          </div>
        ) : (
          <BriefList
            lines={briefs}
            hasFavorites={favorites.length > 0}
            rateLimited={rateLimited}
            failedCount={failedCount}
          />
        )}
      </section>

      <section className={styles.section}>
        <div className={`${styles.row} ${styles.low}`}>
          <div>
            <SilenceTable rows={silent} rateLimited={rateLimited} />
          </div>
          <div>
            <MarketTable rows={market} rateLimited={marketRateLimited} />
            <WeatherBox snapshot={weather} />
          </div>
        </div>
      </section>
    </>
  );
}
