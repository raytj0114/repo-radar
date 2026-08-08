import { describe, expect, it } from 'vitest';
import type { DigestEntry } from '@/lib/digest';
import {
  composeBriefs,
  composeMarket,
  listSilent,
  paperDateFor,
  paperDateForDigestDay,
  pickFrontPage,
  weatherFor,
  type LatestSignal,
  type StarPoint,
} from '@/lib/paper';

// 紙面（Issue #31）の編集ロジック。日付規則は「常に今日の号」:
// 朝6:00 JST（= 21:00 UTC）に翌号へ切り替わる。創刊日は2026-08-02（JST）。

function entry(overrides: Partial<DigestEntry>): DigestEntry {
  return {
    owner: 'vercel',
    repo: 'next.js',
    fullName: 'vercel/next.js',
    tagName: 'v1.0.0',
    releaseName: 'v1.0.0',
    publishedAt: '2026-08-01T10:00:00Z',
    headline: '見出し',
    lede: '前文。',
    summary: '・要点',
    hasBreaking: false,
    noteless: false,
    ...overrides,
  };
}

function signal(overrides: Partial<LatestSignal>): LatestSignal {
  return {
    owner: 'vercel',
    name: 'next.js',
    fullName: 'vercel/next.js',
    tagName: 'v1.0.0',
    publishedAt: '2026-08-01T10:00:00Z',
    summaryFirstLine: null,
    ...overrides,
  };
}

const NOW = new Date('2026-08-02T10:00:00Z');

describe('paperDateFor', () => {
  it('紙面日付は窓終端のJST日付、号数は創刊日からの経過日数+1', () => {
    // 2026-08-02T10:00Z の直近窓終端は 08-01T21:00Z = 08-02 06:00 JST → 第一号
    const paper = paperDateFor(NOW);
    expect(paper.digestDay).toBe('2026-08-01');
    expect(paper.issuedAtIso).toBe('2026-08-01T21:00:00.000Z');
    expect(paper.issueNumber).toBe(1);
  });

  it('朝6:00 JST（21:00 UTC）を境に翌号へ切り替わる', () => {
    // 08-02 20:59 UTC = 08-03 05:59 JST → まだ第一号（08-02付）
    const beforeDawn = paperDateFor(new Date('2026-08-02T20:59:59Z'));
    expect(beforeDawn.issueNumber).toBe(1);
    expect(beforeDawn.digestDay).toBe('2026-08-01');
    // 08-02 21:00 UTC = 08-03 06:00 JST → 第二号（08-03付）
    const atDawn = paperDateFor(new Date('2026-08-02T21:00:00Z'));
    expect(atDawn.issueNumber).toBe(2);
    expect(atDawn.digestDay).toBe('2026-08-02');
  });

  it('朝刊が組まれなかった日も号数は進む（一年後は第三六六号）', () => {
    expect(paperDateFor(new Date('2027-08-02T10:00:00Z')).issueNumber).toBe(366);
  });

  it('創刊日より前でも第一号を下回らない', () => {
    expect(paperDateFor(new Date('2026-07-01T10:00:00Z')).issueNumber).toBe(1);
  });
});

describe('paperDateForDigestDay', () => {
  it('帰属日から発行朝（帰属日21:00 UTC = 翌朝6:00 JST）の号を復元する', () => {
    // 縮刷版が帰属日をそのまま刷ると発行朝より1日古く見える（/digest日付ずれ。Issue #41）
    const paper = paperDateForDigestDay('2026-08-01');
    expect(paper.digestDay).toBe('2026-08-01');
    expect(paper.issuedAtIso).toBe('2026-08-01T21:00:00.000Z');
    expect(paper.issueNumber).toBe(1);
  });

  it('paperDateFor と同じ号に一致する（式の二重化がない）', () => {
    const fromNow = paperDateFor(NOW);
    expect(paperDateForDigestDay(fromNow.digestDay)).toEqual(fromNow);
  });

  it('号数は発行朝のJST日付基準で進む', () => {
    // 帰属日08-02の朝刊は 08-03 06:00 JST 発行 → 第二号
    expect(paperDateForDigestDay('2026-08-02').issueNumber).toBe(2);
  });
});

describe('pickFrontPage', () => {
  it('破壊的変更 → 見出しあり → 要約あり → 新しい順、で一面を選ぶ', () => {
    const breaking = entry({ tagName: 'v1', hasBreaking: true, headline: null, summary: null });
    const headlined = entry({ tagName: 'v2', owner: 'a', repo: 'b', fullName: 'a/b' });
    const bare = entry({
      tagName: 'v3',
      owner: 'c',
      repo: 'd',
      fullName: 'c/d',
      headline: null,
      summary: null,
      publishedAt: '2026-08-01T23:00:00Z',
    });
    const { lead, second } = pickFrontPage([bare, headlined, breaking]);
    expect(lead?.tagName).toBe('v1');
    expect(second?.tagName).toBe('v2');
  });

  it('二番手は一面と別リポジトリから選び、featuredRepoKeysに両方入る', () => {
    const first = entry({ tagName: 'v2.0.0', publishedAt: '2026-08-01T12:00:00Z' });
    const sameRepo = entry({ tagName: 'v2.0.1', publishedAt: '2026-08-01T13:00:00Z' });
    const other = entry({
      owner: 'prisma',
      repo: 'prisma',
      fullName: 'prisma/prisma',
      tagName: 'v7.0.0',
      publishedAt: '2026-08-01T01:00:00Z',
    });
    const { lead, second, featuredRepoKeys } = pickFrontPage([first, sameRepo, other]);
    expect(lead?.tagName).toBe('v2.0.1');
    expect(second?.fullName).toBe('prisma/prisma');
    expect([...featuredRepoKeys].sort()).toEqual(['prisma/prisma', 'vercel/next.js']);
  });

  it('1件なら二番手はnull、0件なら一面もnull（休載）', () => {
    const only = pickFrontPage([entry({})]);
    expect(only.lead).not.toBeNull();
    expect(only.second).toBeNull();
    expect(pickFrontPage([]).lead).toBeNull();
  });
});

describe('composeBriefs', () => {
  it('60日以内の最新信号を新しい順に、一面・二番手の銘柄は除いて並べる', () => {
    const fresh = signal({ publishedAt: '2026-08-01T00:00:00Z' });
    const older = signal({
      owner: 'prisma',
      name: 'prisma',
      fullName: 'prisma/prisma',
      tagName: 'v7.0.0',
      publishedAt: '2026-07-01T00:00:00Z',
    });
    const stale = signal({
      owner: 'expressjs',
      name: 'express',
      fullName: 'expressjs/express',
      publishedAt: '2026-05-01T00:00:00Z',
    });
    const briefs = composeBriefs([older, fresh, stale], new Set(), NOW);
    expect(briefs.map((line) => line.fullName)).toEqual(['vercel/next.js', 'prisma/prisma']);

    const excluded = composeBriefs([older, fresh], new Set(['vercel/next.js']), NOW);
    expect(excluded.map((line) => line.fullName)).toEqual(['prisma/prisma']);
  });

  it('要約の1行目は行頭の「・」を落とし、無ければ着信のみ報じる', () => {
    const summarized = signal({ summaryFirstLine: '・Turbopackが既定に' });
    const bare = signal({
      owner: 'prisma',
      name: 'prisma',
      fullName: 'prisma/prisma',
      tagName: 'v7.2.0',
    });
    const briefs = composeBriefs([summarized, bare], new Set(), NOW);
    expect(briefs[0].text).toBe('Turbopackが既定に');
    expect(briefs[1].text).toBe('v7.2.0 が着信');
  });

  it('完全文の要約（プロンプト第3版）は末尾の句点を落とし、句点+括弧の衝突を避ける', () => {
    const sentence = signal({ summaryFirstLine: '・Turbopackキャッシュの既定を反転した。' });
    const fullWidthStop = signal({
      owner: 'prisma',
      name: 'prisma',
      fullName: 'prisma/prisma',
      summaryFirstLine: 'TypedSQLが複数スキーマに対応した．',
    });
    const exclamation = signal({
      owner: 'expressjs',
      name: 'express',
      fullName: 'expressjs/express',
      summaryFirstLine: '・十年ぶりのメジャーが来た！',
    });
    const briefs = composeBriefs([sentence, fullWidthStop, exclamation], new Set(), NOW);
    expect(briefs.map((line) => line.text)).toEqual([
      'Turbopackキャッシュの既定を反転した',
      'TypedSQLが複数スキーマに対応した',
      '十年ぶりのメジャーが来た！',
    ]);
  });

  it('日付ラベルは 本日 / 昨日 / N日前（漢数字）', () => {
    const today = signal({ publishedAt: '2026-08-02T01:00:00Z' });
    const yesterday = signal({
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      publishedAt: '2026-08-01T09:00:00Z',
    });
    const twelveDays = signal({
      owner: 'c',
      name: 'd',
      fullName: 'c/d',
      publishedAt: '2026-07-21T00:00:00Z',
    });
    const briefs = composeBriefs([today, yesterday, twelveDays], new Set(), NOW);
    expect(briefs.map((line) => line.whenLabel)).toEqual(['本日', '昨日', '十二日前']);
  });
});

describe('listSilent', () => {
  it('180日超のみを沈黙の長い順に並べ、一年超は太字フラグが立つ', () => {
    const active = signal({ publishedAt: '2026-07-01T00:00:00Z' });
    const silent = signal({
      owner: 'expressjs',
      name: 'express',
      fullName: 'expressjs/express',
      tagName: '5.1.0',
      publishedAt: '2025-09-10T00:00:00Z', // 約11箇月
    });
    const dead = signal({
      owner: 'auth0',
      name: 'node-jsonwebtoken',
      fullName: 'auth0/node-jsonwebtoken',
      tagName: 'v9.0.2',
      publishedAt: '2023-08-28T00:00:00Z', // 約3年
    });
    const rows = listSilent([active, silent, dead], NOW);
    expect(rows.map((row) => row.fullName)).toEqual([
      'auth0/node-jsonwebtoken',
      'expressjs/express',
    ]);
    expect(rows[0].overYear).toBe(true);
    expect(rows[0].tagName).toBe('v9.0.2');
    expect(rows[1].overYear).toBe(false);
    expect(rows[1].spanLabel).toBe('十箇月');
  });

  it('ちょうど180日は載せない（超のみ）', () => {
    const boundary = signal({ publishedAt: '2026-02-03T10:00:00Z' }); // NOWの180日前
    expect(listSilent([boundary], NOW)).toEqual([]);
  });
});

describe('composeMarket', () => {
  /** NOW（2026-08-02T10:00Z）の紙面の号。前日比はこの日を基準に判定する */
  const AS_OF = paperDateFor(NOW).digestDay; // '2026-08-01'

  function trending(overrides: Partial<{ full_name: string; stargazers_count: number }> = {}) {
    return {
      full_name: 'astral-sh/ty',
      stargazers_count: 9000,
      created_at: '2026-07-03T10:00:00Z', // NOWの30日前 → 日割300
      ...overrides,
    };
  }

  function history(points: Record<string, StarPoint[]>): Map<string, StarPoint[]> {
    return new Map(Object.entries(points));
  }

  it('直近2観測が当日と前日なら実差分を前日比として出す', () => {
    const rows = composeMarket(
      [trending()],
      history({
        'astral-sh/ty': [
          { day: '2026-08-01', stars: 9000 },
          { day: '2026-07-31', stars: 8700 },
        ],
      }),
      AS_OF,
      NOW
    );
    expect(rows[0]).toMatchObject({ fullName: 'astral-sh/ty', stars: 9000 });
    expect(rows[0].delta).toEqual({ kind: 'diff', delta: 300, previousDay: true });
  });

  it('減少と変化なしも実差分として出す（捏造も切り捨てもしない）', () => {
    const [down, flat] = composeMarket(
      [trending({ full_name: 'a/down' }), trending({ full_name: 'a/flat' })],
      history({
        'a/down': [
          { day: '2026-08-01', stars: 8700 },
          { day: '2026-07-31', stars: 9000 },
        ],
        'a/flat': [
          { day: '2026-08-01', stars: 9000 },
          { day: '2026-07-31', stars: 9000 },
        ],
      }),
      AS_OF,
      NOW
    );
    expect(down.delta).toEqual({ kind: 'diff', delta: -300, previousDay: true });
    expect(flat.delta).toEqual({ kind: 'diff', delta: 0, previousDay: true });
  });

  it('欠測日を挟む場合は直近観測との差へフォールバックする（前日比とは呼ばない）', () => {
    const rows = composeMarket(
      [trending()],
      history({
        'astral-sh/ty': [
          { day: '2026-08-01', stars: 9000 },
          { day: '2026-07-29', stars: 8500 },
        ],
      }),
      AS_OF,
      NOW
    );
    expect(rows[0].delta).toEqual({ kind: 'diff', delta: 500, previousDay: false });
  });

  it('当日分が未採取（最新が前日）でも直近観測比として出す', () => {
    const rows = composeMarket(
      [trending()],
      history({
        'astral-sh/ty': [
          { day: '2026-07-31', stars: 8700 },
          { day: '2026-07-30', stars: 8600 },
        ],
      }),
      AS_OF,
      NOW
    );
    expect(rows[0].delta).toEqual({ kind: 'diff', delta: 100, previousDay: false });
  });

  it('号より新しい観測は使わない（号の中で数字が動かない）', () => {
    const rows = composeMarket(
      [trending()],
      history({
        'astral-sh/ty': [
          { day: '2026-08-02', stars: 9500 },
          { day: '2026-08-01', stars: 9000 },
        ],
      }),
      AS_OF,
      NOW
    );
    expect(rows[0].delta).toEqual({ kind: 'perDay', perDay: 300 });
  });

  it('観測が1件以下の銘柄（新規トレンド・立ち上がり期間）は日割へ縮退する', () => {
    const [single, none] = composeMarket(
      [trending({ full_name: 'a/single' }), trending({ full_name: 'a/none' })],
      history({ 'a/single': [{ day: '2026-08-01', stars: 9000 }] }),
      AS_OF,
      NOW
    );
    expect(single.delta).toEqual({ kind: 'perDay', perDay: 300 });
    expect(none.delta).toEqual({ kind: 'perDay', perDay: 300 });
  });

  it('遡れるのは7日前まで。それより古い観測しか無ければ日割へ縮退する', () => {
    const [inRange, tooOld] = composeMarket(
      [trending({ full_name: 'a/in-range' }), trending({ full_name: 'a/too-old' })],
      history({
        'a/in-range': [
          { day: '2026-08-01', stars: 9000 },
          { day: '2026-07-25', stars: 8000 }, // ちょうど7日前
        ],
        'a/too-old': [
          { day: '2026-08-01', stars: 9000 },
          { day: '2026-07-24', stars: 8000 }, // 8日前
        ],
      }),
      AS_OF,
      NOW
    );
    expect(inRange.delta).toEqual({ kind: 'diff', delta: 1000, previousDay: false });
    expect(tooOld.delta).toEqual({ kind: 'perDay', perDay: 300 });
  });

  it('履歴の引き当ては大小非区別（ケース違いのfullNameでも欠測にしない）', () => {
    const rows = composeMarket(
      [trending({ full_name: 'Astral-sh/TY' })],
      history({
        'astral-sh/ty': [
          { day: '2026-08-01', stars: 9000 },
          { day: '2026-07-31', stars: 8700 },
        ],
      }),
      AS_OF,
      NOW
    );
    expect(rows[0].delta).toEqual({ kind: 'diff', delta: 300, previousDay: true });
  });

  it('created_at が無い（旧キャッシュ）銘柄は履歴も無ければ「─」に倒す', () => {
    const rows = composeMarket(
      [{ full_name: 'a/b', stargazers_count: 100 }],
      new Map(),
      AS_OF,
      NOW
    );
    expect(rows[0]).toMatchObject({ fullName: 'a/b', stars: 100, delta: { kind: 'none' } });
  });

  it('作成当日の銘柄は0日割りを避けて分母1にする', () => {
    const rows = composeMarket(
      [trending({ full_name: 'a/new', stargazers_count: 100 })].map((item) => ({
        ...item,
        created_at: '2026-08-02T09:00:00Z',
      })),
      new Map(),
      AS_OF,
      NOW
    );
    expect(rows[0].delta).toEqual({ kind: 'perDay', perDay: 100 });
  });
});

describe('weatherFor', () => {
  it('残量比で晴/曇/雨に分かれる', () => {
    expect(weatherFor({ remaining: 4812, limit: 5000 }).sky).toBe('晴');
    expect(weatherFor({ remaining: 1000, limit: 5000 }).sky).toBe('曇');
    expect(weatherFor({ remaining: 400, limit: 5000 }).sky).toBe('雨');
  });

  it('晴は安定の見込み、それ以外は節約観測を促す', () => {
    expect(weatherFor({ remaining: 4812, limit: 5000 }).memo).toBe(
      '終日安定の見込み。掃引に支障なし。'
    );
    expect(weatherFor({ remaining: 400, limit: 5000 }).memo).toBe('節約観測を推奨。');
  });

  it('limitが0でも落ちない（雨に倒す）', () => {
    expect(weatherFor({ remaining: 0, limit: 0 }).sky).toBe('雨');
  });
});
