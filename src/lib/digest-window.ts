import type { Release } from '@/lib/github/schemas';

// 朝刊の収集窓（純関数のみ）。digest.ts から #31 で切り出した。
// prisma / gemini / env に依存しないため、紙面の編集ロジック（paper.ts）や
// PlaywrightのglobalSetupからも安全にimportできる。

/** 収集窓の終端時刻（UTC）。vercel.json のcron（`0 21 * * *`）と対にする */
export const WINDOW_END_HOUR_UTC = 21;

/** 半開区間 (start, end]。startちょうどは前日の窓、endちょうどは当日の窓に属する */
export type DigestWindow = { start: Date; end: Date };

/**
 * 実行時刻から収集窓を決める。end = now以前の直近21:00 UTC、start = その24時間前。
 * cronの発火が数分遅れても同じ窓・同じダイジェスト日付に丸まる。
 * 21:00 UTCより前に手動実行した場合は前日分の窓になる（部分的な当日窓を作らない）。
 */
export function digestWindowFor(now: Date): DigestWindow {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), WINDOW_END_HOUR_UTC)
  );
  if (end.getTime() > now.getTime()) {
    end.setUTCDate(end.getUTCDate() - 1);
  }
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * 1回のcronが処理する窓（古い順）。当日窓に加えて前日窓もバックフィルすることで、
 * cron自体の失敗・タイムアウト・要約の一時障害があっても翌日の実行で自動回復する（Issue #36 指摘1）。
 * リリース取得は同じ先頭100件を使い回すため、窓を増やしてもGitHub/AIコストは増えない。
 */
export function digestWindowsFor(now: Date): DigestWindow[] {
  const current = digestWindowFor(now);
  const previous = {
    start: new Date(current.start.getTime() - 24 * 60 * 60 * 1000),
    end: current.start,
  };
  return [previous, current];
}

/** ダイジェストの帰属日（YYYY-MM-DD）。窓の終端のUTC日付で、cacheKey・date列に使う */
export function digestDayOf(window: DigestWindow): string {
  return window.end.toISOString().slice(0, 10);
}

/** 窓内（start排他・end包含）に公開されたリリースのみ抽出する（draftのpublished_at=nullは除外） */
export function releasesInWindow(releases: Release[], window: DigestWindow): Release[] {
  return releases.filter((release) => {
    if (!release.published_at) return false;
    const publishedAt = Date.parse(release.published_at);
    return window.start.getTime() < publishedAt && publishedAt <= window.end.getTime();
  });
}
