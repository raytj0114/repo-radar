import type { DigestEntry } from '@/lib/digest';
import { digestDayOf, digestWindowFor, WINDOW_END_HOUR_UTC } from '@/lib/digest-window';
import { formatSilenceSpanJa, toKanjiNumber } from '@/lib/format';
import { normalizeFullName } from '@/lib/repo-key';

// 紙面（Issue #31）の編集ロジック。すべて純関数で、GitHub/DB/AIには触れない。
// 「日刊 RepoRadar」の号は常に今日の号: 朝6:00 JST（= 窓終端21:00 UTC）に翌号へ切り替わり、
// 朝刊が組まれなかった日も号数だけは進む（一面が休載になる）。2026-08-02のユーザー裁定。

/** 創刊日（JSTの発行日）。号数 = 創刊日からの経過日数 + 1。紙面を公開したPRのマージ日 */
export const FOUNDING_DATE_JST = '2026-08-02';

/** 短信に載せる「最新リリースの新しさ」の上限。これを超えたリポジトリは沈黙候補になる */
export const BRIEF_WINDOW_DAYS = 60;

/** 沈黙の記録に載せる無信号日数の下限（180日超）。一年超は太字扱い */
export const SILENCE_THRESHOLD_DAYS = 180;
export const SILENCE_BOLD_DAYS = 365;

/**
 * 相場欄が見るトレンドの観測窓（日）。星数スナップショットの採取（`src/lib/star-snapshot.ts`）と
 * **必ず同じ値を使う**ため、ここを唯一の出所にする（Issue #39）。
 * ずれると採取側の母集団が表示銘柄を包含しなくなり、前日比が「履歴の無い銘柄」として
 * 静かに欠ける（型にもテストにも出ず、画面上も未採取と区別が付かない）。
 * `/trending` の窓はこれとは独立: 言語フィルタを持つ別画面で、順位の深さも用途も違う
 */
export const MARKET_WINDOW_DAYS = 30;

/**
 * 前日比が作れないときに「直近観測比」として遡ってよい日数（Issue #40）。
 * スナップショットは**バックフィル不能**なので欠測日は永久に埋まらない。少しの欠測は
 * 直近比で埋めるが、これより古い観測との差は日次の相場欄の数字として意味を失う（何日ぶんの
 * 増加か読めない）ため、履歴が無い銘柄と同じ日割表示へ縮退させる。
 */
export const MARKET_DELTA_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 経過日数（floor）。publishedAtが未来でも負にはしない */
function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));
}

/** UTC時刻のJSTカレンダー日付（YYYY-MM-DD） */
function jstDayOf(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export type PaperDate = {
  /** 当日朝刊のDB帰属日（YYYY-MM-DD、UTC窓終端の日付）。DailyDigest.date の特定に使う */
  digestDay: string;
  /** 紙面に刷る発行時刻のISO。formatDateKanjiJa に渡すとJSTの発行日になる */
  issuedAtIso: string;
  /** 第N号 */
  issueNumber: number;
};

/**
 * 帰属日（DailyDigest.date のYYYY-MM-DD）から号を復元する。発行時刻は帰属日の21:00 UTC
 * （= 窓終端 = 翌朝6:00 JST）で、そのJST日付が紙面の日付。縮刷版が過去号を
 * 「発行朝の日付」で刷るための逆引き口（/digest の帰属日直刷りは1日ずれて見えていた）
 */
export function paperDateForDigestDay(digestDay: string): PaperDate {
  const issuedAt = new Date(
    `${digestDay}T${String(WINDOW_END_HOUR_UTC).padStart(2, '0')}:00:00.000Z`
  );
  const issuedOnJst = jstDayOf(issuedAt);
  const foundingMs = Date.parse(`${FOUNDING_DATE_JST}T00:00:00Z`);
  const issuedMs = Date.parse(`${issuedOnJst}T00:00:00Z`);
  const issueNumber = Math.max(1, Math.round((issuedMs - foundingMs) / DAY_MS) + 1);
  return {
    digestDay,
    issuedAtIso: issuedAt.toISOString(),
    issueNumber,
  };
}

/**
 * 「今日の号」を決める。窓終端（= now以前の直近21:00 UTC）が発行時刻で、
 * そのJST日付が紙面の日付。cronの発火遅れや閲覧時刻に依存しない
 */
export function paperDateFor(now: Date): PaperDate {
  return paperDateForDigestDay(digestDayOf(digestWindowFor(now)));
}

/** リポジトリの同一性判定。src/lib/digest.ts の repoKeyOf と同じ正規化（小文字） */
export function paperRepoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

export type FrontPage = {
  lead: DigestEntry | null;
  second: DigestEntry | null;
  /** 一面・二番手で扱ったリポジトリ。短信からは除く */
  featuredRepoKeys: ReadonlySet<string>;
};

/**
 * 当日entriesから一面トップと二番手を選ぶ「最大」の決定則:
 * 破壊的変更 → 見出しあり → 要約あり → 新しい順（同点はfullNameで安定化）。
 * 二番手は一面と別リポジトリから選ぶ（同じ銘柄で紙面を二段占有しない）
 */
export function pickFrontPage(entries: readonly DigestEntry[]): FrontPage {
  const ranked = [...entries].sort((a, b) => {
    const score = (entry: DigestEntry) =>
      (entry.hasBreaking === true ? 4 : 0) +
      (entry.headline !== null ? 2 : 0) +
      (entry.summary !== null ? 1 : 0);
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    const byDate = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (byDate !== 0) return byDate;
    return a.fullName.localeCompare(b.fullName);
  });
  const lead = ranked[0] ?? null;
  const leadKey = lead ? paperRepoKey(lead.owner, lead.repo) : null;
  // findはlead自身のキーを除外して探すため、見つかった時点で必ず別リポジトリ
  const second = ranked.find((entry) => paperRepoKey(entry.owner, entry.repo) !== leadKey) ?? null;
  const featuredRepoKeys = new Set<string>();
  if (lead) featuredRepoKeys.add(paperRepoKey(lead.owner, lead.repo));
  if (second) featuredRepoKeys.add(paperRepoKey(second.owner, second.repo));
  return { lead, second, featuredRepoKeys };
}

/**
 * お気に入り1件の最新信号（最新リリース）。ページ側が fetchReleases の結果と
 * ReleaseSummaryキャッシュ（読み取りのみ）を結合してから渡す
 */
export type LatestSignal = {
  owner: string;
  name: string;
  fullName: string;
  tagName: string;
  /** ISO 8601。draft除外後の最新リリースなので必ず値がある */
  publishedAt: string;
  /** 共有要約（キャッシュ）の要点1行目。無ければnull（紙面側で「着信」表記に倒す） */
  summaryFirstLine: string | null;
};

export type BriefLine = {
  fullName: string;
  /** 短信は紙幅が狭いのでリポジトリ名のみ（owner略） */
  repoName: string;
  href: string;
  /** 要約の1行目（行頭の「・」と末尾の句点を落とした断片） or 「vX.Y.Z が着信」 */
  text: string;
  /** 本日 / 昨日 / N日前（漢数字） */
  whenLabel: string;
  publishedAt: string;
};

function whenLabelOf(days: number): string {
  if (days === 0) return '本日';
  if (days === 1) return '昨日';
  return `${toKanjiNumber(days)}日前`;
}

/**
 * 短信欄: 一面・二番手で扱った銘柄を除き、最新リリースが60日以内のものを新しい順に。
 * 行の本文は共有要約の1行目。短信は断片の欄なので、行頭の「・」と末尾の句点は落として採字する
 * （promptVersion 3 以降の要約は句点で終わる完全文のため、残すと「〜した。（二日前）」と衝突する）。
 * 要約が無ければ着信のみ報じる
 */
export function composeBriefs(
  latest: readonly LatestSignal[],
  excludeRepoKeys: ReadonlySet<string>,
  now: Date
): BriefLine[] {
  return latest
    .filter(
      (signal) =>
        !excludeRepoKeys.has(paperRepoKey(signal.owner, signal.name)) &&
        daysSince(signal.publishedAt, now) <= BRIEF_WINDOW_DAYS
    )
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((signal) => ({
      fullName: signal.fullName,
      repoName: signal.name,
      href: `/repos/${signal.owner}/${signal.name}`,
      text: signal.summaryFirstLine
        ? signal.summaryFirstLine.replace(/^・/, '').replace(/[。．]+$/, '')
        : `${signal.tagName} が着信`,
      whenLabel: whenLabelOf(daysSince(signal.publishedAt, now)),
      publishedAt: signal.publishedAt,
    }));
}

export type SilentRow = {
  fullName: string;
  href: string;
  /** 最終信号のタグ名 */
  tagName: string;
  /** 沈黙期間の和文表記（例: 十箇月、一年三箇月） */
  spanLabel: string;
  /** 一年超は太字 */
  overYear: boolean;
};

/** 沈黙の記録: 最終リリースが180日超のものを沈黙の長い順に。リリースが一度も無いリポジトリは載せない */
export function listSilent(latest: readonly LatestSignal[], now: Date): SilentRow[] {
  return latest
    .filter((signal) => daysSince(signal.publishedAt, now) > SILENCE_THRESHOLD_DAYS)
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
    .map((signal) => {
      const days = daysSince(signal.publishedAt, now);
      return {
        fullName: signal.fullName,
        href: `/repos/${signal.owner}/${signal.name}`,
        tagName: signal.tagName,
        spanLabel: formatSilenceSpanJa(days),
        overYear: days >= SILENCE_BOLD_DAYS,
      };
    });
}

/** 星数の観測点（`RepoStarSnapshot` の1行）。day = YYYY-MM-DD（採取窓終端のUTC日付） */
export type StarPoint = { day: string; stars: number };

/**
 * 相場欄の増減欄。**捏造しない**ための三態（Issue #40）:
 * - `diff`: スナップショットの実差分。`previousDay` が false なら欠測日を挟む直近観測比（表示は `※`）
 * - `perDay`: 観測が1件以下で差分を作れない銘柄の縮退表示（作成からの1日平均★）
 * - `none`: 日割も出せない（`created_at` が無い旧キャッシュ）
 */
export type MarketDelta =
  | { kind: 'diff'; delta: number; previousDay: boolean }
  | { kind: 'perDay'; perDay: number }
  | { kind: 'none' };

export type MarketRow = {
  fullName: string;
  href: string;
  /** 星数はトレンド検索（レンダー時刻）の値。増減だけが朝6時の観測差である点はcaptionで断る */
  stars: number;
  delta: MarketDelta;
};

/** YYYY-MM-DD 同士の日数差（a − b） */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/** 履歴が使えない銘柄の縮退。日割が出せなければ `none`（「─」表示） */
function fallbackDelta(stars: number, createdAt: string | undefined, now: Date): MarketDelta {
  if (!createdAt) return { kind: 'none' };
  return { kind: 'perDay', perDay: Math.round(stars / Math.max(1, daysSince(createdAt, now))) };
}

/**
 * 1銘柄の増減。直近2観測が「紙面の号（asOfDay）から遡って観測窓内」に収まっているときだけ実差分を出す。
 * 観測は順不同で渡してよい（新しい2点を自分で選ぶ）
 */
function marketDeltaFor(
  item: { stargazers_count: number; created_at?: string },
  history: readonly StarPoint[],
  asOfDay: string,
  now: Date
): MarketDelta {
  // YYYY-MM-DD は辞書順＝日付順。新しい2点だけを見るので、渡す側の並びには依存しない
  const [newer, older] = [...history].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  if (!newer || !older) return fallbackDelta(item.stargazers_count, item.created_at, now);

  const newerAge = dayDiff(asOfDay, newer.day);
  const olderAge = dayDiff(asOfDay, older.day);
  // 号より新しい観測は混ぜない（21:00 UTC前の閲覧で当日分がまだ無い状態と区別できなくなる）
  const usable = newerAge >= 0 && olderAge <= MARKET_DELTA_LOOKBACK_DAYS && olderAge > newerAge;
  if (!usable) return fallbackDelta(item.stargazers_count, item.created_at, now);

  return {
    kind: 'diff',
    delta: newer.stars - older.stars,
    previousDay: newerAge === 0 && olderAge === 1,
  };
}

/**
 * 相場欄: トレンド検索の結果に星数スナップショットの実差分を突き合わせる。
 * `historyByFullName` のキーは `normalizeFullName` 済み、`asOfDay` は紙面の号（`PaperDate.digestDay`）
 */
export function composeMarket(
  items: readonly { full_name: string; stargazers_count: number; created_at?: string }[],
  historyByFullName: ReadonlyMap<string, readonly StarPoint[]>,
  asOfDay: string,
  now: Date
): MarketRow[] {
  return items.map((item) => ({
    fullName: item.full_name,
    href: `/repos/${item.full_name}`,
    stars: item.stargazers_count,
    delta: marketDeltaFor(
      item,
      historyByFullName.get(normalizeFullName(item.full_name)) ?? [],
      asOfDay,
      now
    ),
  }));
}

export type Weather = {
  sky: '晴' | '曇' | '雨';
  memo: string;
};

/** 天気欄: API残量の比率を空模様にする（モック02の規則そのまま） */
export function weatherFor(snapshot: { remaining: number; limit: number }): Weather {
  const ratio = snapshot.limit > 0 ? snapshot.remaining / snapshot.limit : 0;
  const sky = ratio > 0.5 ? '晴' : ratio > 0.1 ? '曇' : '雨';
  return {
    sky,
    memo: ratio > 0.5 ? '終日安定の見込み。掃引に支障なし。' : '節約観測を推奨。',
  };
}
