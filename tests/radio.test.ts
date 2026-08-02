import { describe, expect, it } from 'vitest';
import type { DigestEntry } from '@/lib/digest';
import { pickFrontPage, type PaperDate, type SilentRow, type Weather } from '@/lib/paper';
import {
  buildOutageStations,
  buildStations,
  composeScheduledBroadcast,
  composeWeatherBroadcast,
  NIGHT_STANDBY_SEGMENTS,
  RADIO_BAND,
  RADIO_CAPTURE,
  toSpokenDateJa,
  toSpokenDayJa,
  toSpokenRepo,
  toSpokenSpan,
  toSpokenSummary,
  toSpokenTag,
  type RadioSegment,
} from '@/lib/radio';

// 深夜放送（Issue #32）の原稿。放送は音にしか存在しないので、
// 「何をどの順で読むか」はここでしか検証できない。

const PAPER: PaperDate = {
  digestDay: '2026-08-01',
  // 2026-08-01T21:00Z = 2026-08-02 06:00 JST（朝刊の発行時刻）
  issuedAtIso: '2026-08-01T21:00:00.000Z',
  issueNumber: 1,
};

const WEATHER: Weather = { sky: '晴', memo: '終日安定の見込み。掃引に支障なし。' };
const RATE_LIMIT = { limit: 5000, remaining: 4999, reset: 0, used: 1 };

function entry(overrides: Partial<DigestEntry>): DigestEntry {
  return {
    owner: 'vercel',
    repo: 'next.js',
    fullName: 'vercel/next.js',
    tagName: 'v16.4.0',
    releaseName: 'v16.4.0',
    publishedAt: '2026-08-01T10:00:00Z',
    headline: '見出し',
    lede: '前文。',
    summary: '・要点',
    hasBreaking: false,
    noteless: false,
    ...overrides,
  };
}

function scheduled(
  entries: DigestEntry[],
  overrides: Partial<Parameters<typeof composeScheduledBroadcast>[0]> = {}
) {
  return composeScheduledBroadcast({
    paper: PAPER,
    entries,
    front: pickFrontPage(entries),
    weather: WEATHER,
    rateLimit: RATE_LIMIT,
    ...overrides,
  });
}

/** 段落の本文を1本につなぐ。「読まれるかどうか」だけを見るため */
function transcript(segments: readonly RadioSegment[]): string {
  return segments.map((segment) => segment.text).join('\n');
}

describe('読み下しの正規化', () => {
  it('リポジトリ名は区切り記号を読点と空白に均す', () => {
    expect(toSpokenRepo('vercel/next.js')).toBe('vercel、next.js');
    expect(toSpokenRepo('silent-archive/legacy-parser')).toBe('silent archive、legacy parser');
    expect(toSpokenRepo('octocat/some_tool')).toBe('octocat、some tool');
  });

  it('タグは「バージョン」を補う。バージョンに見えないタグは素通しする', () => {
    expect(toSpokenTag('v16.4.0')).toBe('バージョン 16.4.0');
    expect(toSpokenTag('7.2.0')).toBe('バージョン 7.2.0');
    expect(toSpokenTag('nightly')).toBe('nightly');
    // 「v」で始まっても続きが数字でなければバージョン表記ではない
    expect(toSpokenTag('vitest-3')).toBe('vitest-3');
  });

  it('要点は行頭の「・」を落として句点で連結する', () => {
    expect(toSpokenSummary('・ビルドを高速化\n・PPRの安定化')).toBe(
      'ビルドを高速化。PPRの安定化。'
    );
    // 既に句点がある行を二重にしない
    expect(toSpokenSummary('・キャッシュを刷新。')).toBe('キャッシュを刷新。');
    expect(toSpokenSummary('   ')).toBe('');
  });

  it('沈黙期間の「箇月」は読み違えられないよう「か月」にする', () => {
    expect(toSpokenSpan('十箇月')).toBe('十か月');
    expect(toSpokenSpan('一年三箇月')).toBe('一年三か月');
    expect(toSpokenSpan('二年')).toBe('二年');
  });

  it('日付はJSTで読み、放送では年を読まない', () => {
    expect(toSpokenDateJa(PAPER.issuedAtIso)).toBe('八月二日、日曜日');
    expect(toSpokenDayJa(PAPER.issuedAtIso)).toBe('二日');
  });
});

describe('composeScheduledBroadcast（第一放送）', () => {
  it('一面・二番手を読み、残りは件数に畳む', () => {
    const entries = [
      entry({
        headline: 'キャッシュ既定、静かに反転',
        lede: '未明の公開である。',
        summary: '・既定を反転',
      }),
      entry({
        owner: 'prisma',
        repo: 'prisma',
        fullName: 'prisma/prisma',
        tagName: 'v7.4.0',
        headline: 'TypedSQL、複数スキーマへ',
        publishedAt: '2026-08-01T09:00:00Z',
      }),
      entry({
        owner: 'colinhacks',
        repo: 'zod',
        fullName: 'colinhacks/zod',
        tagName: 'v4.0.1',
        headline: null,
        lede: null,
        summary: null,
        publishedAt: '2026-08-01T08:00:00Z',
      }),
    ];
    const text = transcript(scheduled(entries));

    expect(text).toContain('八月二日、日曜日。朝六時の、定時放送を、お送りします。');
    expect(text).toContain('キャッシュ既定、静かに反転');
    expect(text).toContain('TypedSQL、複数スキーマへ');
    // 3件のうち2件を記事にしたので、残りは1件
    expect(text).toContain('このほか、一件のリリースが、届いています。');
    // 一面・二番手以外は個別に読まない
    expect(text).not.toContain('colinhacks');
  });

  it('要約も見出しも無いリリースはノートが無い旨を読む', () => {
    const text = transcript(
      scheduled([entry({ headline: null, lede: null, summary: null, noteless: true })])
    );
    expect(text).toContain('vercel、next.js、バージョン 16.4.0。リリースノートは、ありません。');
  });

  it('一面で読んだ破壊的変更を、お知らせ欄で繰り返さない', () => {
    const entries = [entry({ hasBreaking: true })];
    const segments = scheduled(entries);
    const text = transcript(segments);

    expect(text).toContain('破壊的変更を、含みます。');
    expect(text).not.toContain('続いて、破壊的変更の、お知らせです。');
    // 予告音は記事の側で鳴る
    expect(segments.some((segment) => segment.alert === true)).toBe(true);
  });

  // 破壊的変更は必ず一面に上がる（pickFrontPage の決定則）ので、
  // お知らせ欄に載るのは「3件目以降の破壊的変更」になる
  it('一面・二番手に載りきらなかった破壊的変更は改めて告知する', () => {
    const entries = [
      entry({ headline: '一面', hasBreaking: true }),
      entry({
        owner: 'prisma',
        repo: 'prisma',
        fullName: 'prisma/prisma',
        tagName: 'v7.4.0',
        headline: '二番手',
        hasBreaking: true,
        publishedAt: '2026-08-01T09:00:00Z',
      }),
      entry({
        owner: 'facebook',
        repo: 'react',
        fullName: 'facebook/react',
        tagName: 'v20.0.0',
        headline: 'レガシーContextの削除',
        hasBreaking: true,
        publishedAt: '2026-08-01T08:00:00Z',
      }),
    ];
    const text = transcript(scheduled(entries));

    expect(text).toContain('続いて、破壊的変更の、お知らせです。');
    expect(text).toContain('facebook、react、バージョン 20.0.0。レガシーContextの削除。');
    // 一面・二番手で読んだ分は繰り返さない
    expect(text.match(/二番手/g)).toHaveLength(1);
  });

  it('朝刊が無い日は休載を告げる', () => {
    const text = transcript(scheduled([]));
    expect(text).toContain('本日の朝刊は、休載です。');
    expect(text).not.toContain('まず、本日の一面です。');
    // 休載でも観測情報と締めは読む（放送は落ちない）
    expect(text).toContain('残量4999');
    expect(text).toContain('以上、定時放送でした。');
  });

  it('観測できないときは観測情報の段落ごと落とす', () => {
    const text = transcript(scheduled([entry({})], { weather: null, rateLimit: null }));
    expect(text).not.toContain('観測情報です。');
    expect(text).toContain('以上、定時放送でした。');
  });
});

describe('composeWeatherBroadcast（気象通報）', () => {
  const silent: SilentRow[] = [
    {
      fullName: 'silent-archive/legacy-parser',
      href: '/repos/silent-archive/legacy-parser',
      tagName: 'v0.9.2',
      spanLabel: '三年二箇月',
      overYear: true,
    },
  ];

  function weatherReport(overrides: Partial<Parameters<typeof composeWeatherBroadcast>[0]> = {}) {
    return transcript(
      composeWeatherBroadcast({
        paper: PAPER,
        silent,
        observation: 'complete',
        weather: WEATHER,
        rateLimit: RATE_LIMIT,
        ...overrides,
      })
    );
  }

  it('残量と沈黙の観測を読む', () => {
    const text = weatherReport();
    expect(text).toContain('二日、六時の観測。');
    expect(text).toContain('コア資源。残量、4999。上限、5000。晴れ。');
    expect(text).toContain(
      'silent archive、legacy parser。最終信号、バージョン 0.9.2。三年二か月、無信号。'
    );
  });

  it('沈黙が無い日はその旨を読む', () => {
    const text = weatherReport({ silent: [] });
    expect(text).toContain('本日、沈黙の記録は、ありません。');
  });

  it('残量が観測できなくても放送は続ける', () => {
    const text = weatherReport({ weather: null, rateLimit: null });
    expect(text).toContain('コア資源。ただいま、観測できません。');
    expect(text).toContain('以上、レポレーダー気象通報でした。');
  });

  // 観測ゼロ（本当に沈黙が無い）と観測不能（レート上限で見えていない）は別物。
  // 取り違えると「すべての銘柄が信号を発しています」と嘘を放送し続ける
  it('レート上限で観測できなかったときは「沈黙なし」と断言しない', () => {
    const text = weatherReport({ silent: [], observation: 'rate-limited' });
    expect(text).toContain('沈黙の観測は、ただいま、休止しています。');
    expect(text).not.toContain('沈黙の記録は、ありません');
    expect(text).not.toContain('すべての銘柄が');
  });

  it('一部の取得に失敗したときは観測が欠けている旨を添える', () => {
    const text = weatherReport({ observation: 'partial' });
    // 取れた銘柄は読んだうえで、網羅していないことを告げる
    expect(text).toContain('silent archive、legacy parser');
    expect(text).toContain('なお、一部の銘柄は、観測できていません。');
  });
});

describe('局の組み立て', () => {
  const stations = buildStations(
    {
      paper: PAPER,
      entries: [entry({})],
      front: pickFrontPage([entry({})]),
      weather: WEATHER,
      rateLimit: RATE_LIMIT,
    },
    {
      paper: PAPER,
      silent: [],
      observation: 'complete',
      weather: WEATHER,
      rateLimit: RATE_LIMIT,
    }
  );

  it('3局が帯の内側に、同調範囲を重ねずに並ぶ', () => {
    expect(stations.map((station) => station.id)).toEqual(['r1', 'wx', 'nb']);
    for (const station of stations) {
      expect(station.freq).toBeGreaterThanOrEqual(RADIO_BAND.lo);
      expect(station.freq).toBeLessThanOrEqual(RADIO_BAND.hi);
    }
    // 同調幅が重なると、1つの周波数で2局が受信できてしまう
    for (const a of stations) {
      for (const b of stations) {
        if (a.id === b.id) continue;
        expect(Math.abs(a.freq - b.freq)).toBeGreaterThan(RADIO_CAPTURE * 2);
      }
    }
  });

  it('気象通報だけが繰り返し放送になる', () => {
    expect(stations.find((station) => station.id === 'wx')?.loop).toBe(true);
    expect(stations.find((station) => station.id === 'r1')?.loop).toBeUndefined();
  });

  it('深夜便は開局前なので休止告知だけを流す', () => {
    expect(stations.find((station) => station.id === 'nb')?.segments).toEqual([
      ...NIGHT_STANDBY_SEGMENTS,
    ]);
  });

  it('縮退時も全局が休止を告げる（無音にはしない）', () => {
    const outage = buildOutageStations();
    expect(outage).toHaveLength(3);
    expect(transcript(outage[0].segments)).toContain('この放送は、休止しています。');
    // 繰り返す原稿が休止告知になると延々と流れ続けるため、気象通報のloopは降ろす
    expect(outage.find((station) => station.id === 'wx')?.loop).toBe(false);
  });

  it('空の段落を読ませない', () => {
    for (const station of [...stations, ...buildOutageStations()]) {
      for (const segment of station.segments) {
        expect(segment.text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
