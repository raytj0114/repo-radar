import { describe, expect, it } from 'vitest';
import type { DigestEntry } from '@/lib/digest';
import {
  composeBriefs,
  composeMarket,
  listSilent,
  paperDateFor,
  pickFrontPage,
  weatherFor,
  type LatestSignal,
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
  it('星数と日割（作成からの1日平均）を組む', () => {
    const rows = composeMarket(
      [
        { full_name: 'astral-sh/ty', stargazers_count: 9000, created_at: '2026-07-03T10:00:00Z' },
        { full_name: 'a/b', stargazers_count: 100, created_at: '2026-08-02T09:00:00Z' },
      ],
      NOW
    );
    // 30日前作成・9000★ → 日割300
    expect(rows[0]).toMatchObject({ fullName: 'astral-sh/ty', stars: 9000, perDay: 300 });
    // 作成当日は0日割りを避けて分母1
    expect(rows[1].perDay).toBe(100);
  });

  it('created_at が無い（旧キャッシュ）場合は日割をnullにする', () => {
    const rows = composeMarket([{ full_name: 'a/b', stargazers_count: 100 }], NOW);
    expect(rows[0].perDay).toBeNull();
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
