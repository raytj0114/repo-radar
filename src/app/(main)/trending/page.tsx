import Link from 'next/link';
import type { Metadata } from 'next';
import clsx from 'clsx';
import { Colophon } from '@/components/features/paper/colophon';
import { MenMasthead } from '@/components/features/paper/men-masthead';
import paperStyles from '@/components/features/paper/paper.module.css';
import { TrendTable, type TrendRow } from '@/components/features/trending/trend-table';
import { auth } from '@/lib/auth';
import { GitHubRateLimitError, searchTrendingRepositories } from '@/lib/github/client';
import { settle } from '@/lib/github/concurrent';
import {
  composeMarket,
  MARKET_WINDOW_DAYS,
  paperDateFor,
  paperRepoKey,
  type StarPoint,
} from '@/lib/paper';
import { prisma } from '@/lib/prisma';
import { loadStarHistories } from '@/lib/star-snapshot';

// トレンド面も紙面の一部なので、テンプレート（%s | RepoRadar）を使わない
export const metadata: Metadata = {
  title: { absolute: 'トレンド面｜日刊 RepoRadar' },
};

const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Rust', 'Go'] as const;

type SearchItems = TrendRow['item'][];

/**
 * トレンド面（Issue #41）: 一面の相場欄（上位6銘柄）の続き面＝スター相場の全表。
 * 観測窓は相場欄・星数スナップショットの採取と同じ `MARKET_WINDOW_DAYS` を使う。
 * ここが採取の母集団（トレンド上位30件）と一致するため、全表でも前日比が欠けにくい
 * （#39時点の「/trendingの窓は独立」裁定は、続き面への再定義に伴い #41 で統一へ変更）。
 *
 * この面は同一ページのServer Action（購読判子）を持つため、**Suspense境界を置かない**
 * （`loading.tsx` も不可）。境界があるとaction応答が届かずUIがpendingで固まる
 * （Issue #47 の実測。`docs/ARCHITECTURE.md` のレンダリング制約）
 */
export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ language?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const { language: rawLanguage } = await searchParams;
  const language = LANGUAGES.find((l) => l === rawLanguage);

  const now = new Date();
  const paper = paperDateFor(now);
  const createdAfter = new Date(now.getTime() - MARKET_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // GitHub検索とお気に入りの取得は互いに独立なので同時に投げる（Issue #6）。
  // 検索が失敗しても favorites の取得を巻き込まないよう settle で包む
  const [searchSettled, favorites] = await Promise.all([
    settle(searchTrendingRepositories({ language, createdAfter })),
    prisma.favoriteRepo.findMany({
      where: { userId: session.user.id },
      select: { owner: true, name: true },
    }),
  ]);
  const subscribedKeys = new Set(favorites.map((f) => paperRepoKey(f.owner, f.name)));

  // 縮退の方針は紙面と同じ「面は落ちない」: レート上限はその旨を報じ、
  // 他の失敗はデータリンク不通として休載する（エラー境界へ全面では倒さない）
  let items: SearchItems = [];
  let rateLimited = false;
  let fetchFailed = false;
  if (searchSettled.status === 'fulfilled') {
    items = searchSettled.value.items;
  } else if (searchSettled.reason instanceof GitHubRateLimitError) {
    rateLimited = true;
  } else {
    fetchFailed = true;
    console.error('[trending] trending fetch failed:', searchSettled.reason);
  }

  // 前日比（Issue #40）: 一面の相場欄と同じく星数スナップショットの実差分だけを出す。
  // 履歴が引けなくても面は落とさない（全銘柄が日割へ縮退する。捏造はしない）
  let histories: Map<string, StarPoint[]> = new Map();
  if (items.length > 0) {
    const historiesSettled = await settle(
      loadStarHistories(
        items.map((item) => item.full_name),
        paper.digestDay
      )
    );
    if (historiesSettled.status === 'fulfilled') {
      histories = historiesSettled.value;
    } else {
      console.error('[trending] star snapshot query failed:', historiesSettled.reason);
    }
  }
  const market = composeMarket(items, histories, paper.digestDay, now);
  const rows: TrendRow[] = items.map((item, index) => ({
    rank: index + 1,
    item,
    delta: market[index].delta,
    subscribed: subscribedKeys.has(paperRepoKey(item.owner.login, item.name)),
  }));

  return (
    <main className={paperStyles.backdrop}>
      <div className={paperStyles.paper}>
        <MenMasthead paper={paper} title="トレンド面" edition="相場の全表" />

        <section className={`${paperStyles.section} ${paperStyles.noRule}`}>
          <span className={paperStyles.kanban}>言語別</span>
          <nav aria-label="言語別" className={paperStyles.searchForm}>
            <LanguageStamp href="/trending" label="すべて" active={!language} />
            {LANGUAGES.map((l) => (
              <LanguageStamp
                key={l}
                href={`/trending?language=${l}`}
                label={l}
                active={language === l}
              />
            ))}
          </nav>
        </section>

        <section className={paperStyles.section}>
          <span className={paperStyles.kanban}>相場</span>
          {rows.length > 0 ? (
            <TrendTable rows={rows} />
          ) : (
            <p className={paperStyles.kyusai}>
              {rateLimited
                ? '検索枠の上限につき本日は休載。'
                : fetchFailed
                  ? 'データリンク不通につき休載。'
                  : '該当銘柄なし。'}
            </p>
          )}
        </section>

        <Colophon userName={session.user.name} issueNumber={paper.issueNumber} current="trending" />
      </div>
    </main>
  );
}

/** 言語の絞り込みをリンクの判子で組む。現在の絞り込みは押下済みの判子（stampOn）で示す */
function LanguageStamp({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(paperStyles.stamp, active && paperStyles.stampOn)}
    >
      {label}
    </Link>
  );
}
