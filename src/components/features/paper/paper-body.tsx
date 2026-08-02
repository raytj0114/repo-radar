import { digestEntriesSchema, type DigestEntry } from '@/lib/digest';
import { dailyDigestKey, releaseSummaryKey } from '@/lib/github/cache-key';
import {
  fetchRateLimit,
  fetchReleases,
  GitHubRateLimitError,
  searchTrendingRepositories,
} from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import type { RateLimitSnapshot } from '@/lib/github/schemas';
import {
  composeBriefs,
  composeMarket,
  listSilent,
  pickFrontPage,
  type LatestSignal,
  type MarketRow,
  type PaperDate,
} from '@/lib/paper';
import { prisma } from '@/lib/prisma';
import { BriefList } from './brief-list';
import { LeadArticle, LeadHoliday, SecondArticle } from './lead-article';
import { MarketTable } from './market-table';
import { SilenceTable } from './silence-table';
import { WeatherBox } from './weather-box';
import styles from './paper.module.css';

/**
 * 1リポジトリあたりのリリース取得数。短信・沈黙は最新1件しか使わないが、
 * 旧ダッシュボードと同じ取得量にして詳細画面とのfetchキャッシュ共有を保つ
 */
const RELEASES_PER_REPO = 5;

/** 相場欄の観測窓と行数（/trending と同じ30日窓。行数は紙面の組みに合わせる） */
const MARKET_WINDOW_DAYS = 30;
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

  // お気に入り全銘柄の最新信号（旧タイムラインの取得を吸収。1リポジトリ1リクエスト）
  const settledReleases = await Promise.allSettled(
    favorites.map((favorite) =>
      fetchReleases(favorite.owner, favorite.name, { perPage: RELEASES_PER_REPO, maxPages: 1 })
    )
  );

  let rateLimited = false;
  let failedCount = 0;
  const signals: LatestSignal[] = [];
  settledReleases.forEach((result, index) => {
    const favorite = favorites[index];
    if (result.status === 'rejected') {
      if (result.reason instanceof GitHubRateLimitError) {
        rateLimited = true;
      } else {
        failedCount += 1;
        console.error(`[paper] release fetch failed repo=${favorite.fullName}:`, result.reason);
      }
      return;
    }
    // null はリポジトリ消滅・改名（404）。紙面からは黙って除く（旧ダッシュボードと同じ）
    const releases = (result.value ?? []).filter((release) => release.published_at !== null);
    if (releases.length === 0) return;
    const latest = releases.reduce((a, b) =>
      Date.parse(a.published_at ?? '') >= Date.parse(b.published_at ?? '') ? a : b
    );
    signals.push({
      owner: favorite.owner,
      name: favorite.name,
      fullName: favorite.fullName,
      tagName: latest.tag_name,
      publishedAt: latest.published_at ?? '',
      summaryFirstLine: null,
    });
  });

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

  // 相場（searchプール）: レート上限はその旨を報じ、他の失敗はデータリンク不通として休載
  let market: MarketRow[] | null = null;
  let marketRateLimited = false;
  if (marketSettled.status === 'fulfilled') {
    market = composeMarket(marketSettled.value.items, now);
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
