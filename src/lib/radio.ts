import type { DigestEntry } from '@/lib/digest';
import { toKanjiNumber } from '@/lib/format';
import { releaseSummaryKey } from '@/lib/github/cache-key';
import type { RateLimitSnapshot } from '@/lib/github/schemas';
import type { FrontPage, PaperDate, SilentRow, Weather } from '@/lib/paper';

// 深夜放送「JORR」（Issue #32）の編集ロジック。docs/mocks/04-night-radio.html が設計。
// すべて純関数で、GitHub/DB/AIには触れない（受信機のUIからもimportするためブラウザで動く必要がある）。
//
// 放送は音にしか存在しない。ここで組んだ原稿は client component へ props で渡すが、
// **決してレンダーしない**。画面に出した瞬間この画面の主張が壊れる。
//
// AI呼び出しはゼロ。原稿の素材は当日の DailyDigest.entries（朝刊）と、
// 紙面（src/lib/paper.ts）が既に使っている観測値だけをルールベースで読み下す。

/** 受信できる周波数帯（MHz）。ダイヤル盤の目盛もこの範囲で刷る */
export const RADIO_BAND = { lo: 76, hi: 95 } as const;

/** 同調幅（MHz）。局の周波数からこの範囲内に針があれば受信できる */
export const RADIO_CAPTURE = 0.5;

/** 電源投入時の針の位置。どの局にも当たらない位置にして「探す」ところから始めさせる */
export const RADIO_INITIAL_FREQ = 88.0;

export type RadioStationId = 'r1' | 'wx' | 'nb';

/** ダイヤル盤に刷る局の位置と名前。原稿とは独立（休止中でも局は帯にいる） */
export const RADIO_STATION_META = {
  r1: { id: 'r1', freq: 79.5, name: 'レポレーダー第一', short: '第一放送' },
  wx: { id: 'wx', freq: 86.0, name: '気象通報', short: '気象通報' },
  nb: { id: 'nb', freq: 92.4, name: '深夜便', short: '深夜便' },
} as const satisfies Record<RadioStationId, Pick<RadioStation, 'id' | 'freq' | 'name' | 'short'>>;

/** 原稿の一段落。`pre` は前の段落を読み終えてからの間（ms） */
export type RadioSegment = {
  text: string;
  pre?: number;
  /** 読む前に予告音を鳴らす（破壊的変更のお知らせ） */
  alert?: boolean;
};

export type RadioStation = {
  id: RadioStationId;
  freq: number;
  /** ニキシー窓に出す局名 */
  name: string;
  /** ダイヤル盤に刷る短い局名 */
  short: string;
  /** 冒頭の合図 */
  signal: 'jihou' | 'chime' | null;
  /** 合図から第一声までの間（ms）。合図が無い局は0 */
  openingGap: number;
  rate: number;
  pitch: number;
  /** 深夜の声（別の音声を割り当てる） */
  night?: boolean;
  /** 読み終えたら繰り返す（気象通報は定点観測なので流し続ける） */
  loop?: boolean;
  loopGap?: number;
  segments: RadioSegment[];
};

// ---- 読み下しの正規化 ----
// 読み辞書は持たない。持つと「登録済みのリポジトリだけ自然に読める」不公平が生まれ、
// 辞書のメンテナンスがユーザーのお気に入りに比例して増える。
// 記号を句読点と空白に均すところまでを機械的にやり、あとは音声エンジンに委ねる。

/** `vercel/next.js` → `vercel、next.js`。区切り記号を読点と空白に均す */
export function toSpokenRepo(fullName: string): string {
  return fullName
    .split('/')
    .map((part) => part.replace(/[-_]+/g, ' ').trim())
    .filter((part) => part.length > 0)
    .join('、');
}

/** `v16.4.0` → `バージョン 16.4.0`。数字で始まるタグにも「バージョン」を補う */
export function toSpokenTag(tagName: string): string {
  const tag = tagName.trim();
  const versionLike = /^[vV](\d.*)$/.exec(tag);
  if (versionLike) return `バージョン ${versionLike[1]}`;
  if (/^\d/.test(tag)) return `バージョン ${tag}`;
  return tag;
}

/** 要点3行（`・`区切り）を読み下す。`・A\n・B` → `A。B。` */
export function toSpokenSummary(summary: string): string {
  const lines = summary
    .split('\n')
    .map((line) =>
      line
        .replace(/^[・\-*\s]+/, '')
        .replace(/[。．]+$/, '')
        .trim()
    )
    .filter((line) => line.length > 0);
  return lines.length > 0 ? `${lines.join('。')}。` : '';
}

/**
 * 沈黙期間の和文表記を読み下す。`十箇月` → `十か月`
 * （`箇月` を「はこつき」と読む音声エンジンがあるため。表示は紙面のまま `箇月` を使う）
 */
export function toSpokenSpan(spanLabel: string): string {
  return spanLabel.replace(/箇月/g, 'か月');
}

function dateParts(iso: string): { month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return { month: Number(part('month')), day: Number(part('day')), weekday: part('weekday') };
}

/** `二〇二六-〇八-〇二T21:00Z` → `八月二日、日曜日`（JST。年は放送では読まない） */
export function toSpokenDateJa(iso: string): string {
  const { month, day, weekday } = dateParts(iso);
  return `${toKanjiNumber(month)}月${toKanjiNumber(day)}日、${weekday}`;
}

/** 日付のうち日だけ（`二日`）。繰り返し流す気象通報が毎周期フル日付を読まないようにする */
export function toSpokenDayJa(iso: string): string {
  return `${toKanjiNumber(dateParts(iso).day)}日`;
}

// ---- 原稿 ----

const CALL_SIGN = 'ジェイ、オー、アール、アール';

const SKY_READING = { 晴: '晴れ', 曇: '曇り', 雨: '雨' } as const;

/** データリンクが切れているときの告知。実機の放送休止と同じく、黙らずに休止を報じる */
export const OUTAGE_SEGMENTS: readonly RadioSegment[] = [
  { text: 'こちらは、レポレーダー放送です。', pre: 600 },
  { text: 'データリンクの障害により、この放送は、休止しています。', pre: 500 },
];

/**
 * 深夜便の休止告知。本編（ソフトウェア史のエピソード）は別Issueで、
 * それまでこの局は帯にいるが放送していない。後続Issueは segments を差し替えるだけで開局できる
 */
export const NIGHT_STANDBY_SEGMENTS: readonly RadioSegment[] = [
  { text: `${CALL_SIGN}、第二放送。`, pre: 800 },
  { text: '深夜便は、ただいま、放送を、休止しています。', pre: 1200 },
  { text: '周波数は、そのままで。', pre: 1600 },
];

/** リリース1件の記事。見出し・前文・要点の順に読み、無いものは飛ばす */
function articleSegment(entry: DigestEntry, pre: number): RadioSegment {
  const body = [
    entry.headline ? `${entry.headline}。` : '',
    entry.lede ?? '',
    entry.summary ? toSpokenSummary(entry.summary) : '',
    entry.hasBreaking === true ? '破壊的変更を、含みます。' : '',
  ]
    .filter((part) => part.length > 0)
    .join('');
  return {
    text:
      `${toSpokenRepo(entry.fullName)}、${toSpokenTag(entry.tagName)}。` +
      (body.length > 0 ? body : 'リリースノートは、ありません。'),
    pre,
    ...(entry.hasBreaking === true ? { alert: true } : {}),
  };
}

function entryKey(entry: DigestEntry): string {
  return releaseSummaryKey(entry.owner, entry.repo, entry.tagName);
}

export type ScheduledBroadcastInput = {
  paper: PaperDate;
  entries: readonly DigestEntry[];
  /** 紙面と同じ決定則で選んだ一面・二番手（`pickFrontPage`） */
  front: FrontPage;
  weather: Weather | null;
  rateLimit: RateLimitSnapshot | null;
};

/**
 * 第一放送（定時放送）。当日の朝刊entriesを読み下す。
 * 一面・二番手を記事として読み、残りは件数だけ報じる（紙面の短信に相当する部分は
 * 耳で追えないので数に畳む）。破壊的変更は一面・二番手で読んだ分を除いて改めて告知する
 */
export function composeScheduledBroadcast(input: ScheduledBroadcastInput): RadioSegment[] {
  const { paper, entries, front, weather, rateLimit } = input;
  const segments: RadioSegment[] = [
    { text: `${CALL_SIGN}。こちらは、レポレーダー放送です。`, pre: 600 },
    {
      text: `${toSpokenDateJa(paper.issuedAtIso)}。朝六時の、定時放送を、お送りします。`,
      pre: 300,
    },
  ];

  if (entries.length === 0) {
    segments.push({
      text: '本日の朝刊は、休載です。あたらしいリリースは、届いていません。',
      pre: 900,
    });
  } else {
    const featured = [front.lead, front.second].filter((entry) => entry !== null);
    const featuredKeys = new Set(featured.map(entryKey));

    segments.push({ text: 'まず、本日の一面です。', pre: 900 });
    featured.forEach((entry, index) =>
      segments.push(articleSegment(entry, index === 0 ? 400 : 700))
    );

    const others = entries.length - featuredKeys.size;
    if (others > 0) {
      segments.push({
        text: `このほか、${toKanjiNumber(others)}件のリリースが、届いています。`,
        pre: 700,
      });
    }

    // 一面・二番手の記事内で既に「破壊的変更を含みます」と読んだものは繰り返さない
    const breaking = entries.filter(
      (entry) => entry.hasBreaking === true && !featuredKeys.has(entryKey(entry))
    );
    if (breaking.length > 0) {
      segments.push({ text: '続いて、破壊的変更の、お知らせです。', pre: 1100, alert: true });
      for (const entry of breaking) {
        segments.push({
          text:
            `${toSpokenRepo(entry.fullName)}、${toSpokenTag(entry.tagName)}。` +
            (entry.headline ? `${entry.headline}。` : '破壊的変更を、含みます。'),
          pre: 700,
        });
      }
    }
  }

  if (rateLimit && weather) {
    segments.push({
      text:
        `観測情報です。本日のエーピーアイ、残量${rateLimit.remaining}。上限${rateLimit.limit}。` +
        `${SKY_READING[weather.sky]}。${weather.memo}`,
      pre: 1100,
    });
  }

  segments.push({
    text: `以上、定時放送でした。${CALL_SIGN}。次の放送まで、どうぞ、よい観測を。`,
    pre: 900,
  });
  return segments;
}

/**
 * 沈黙の観測がどこまで届いたか。
 * `complete` 以外のとき「沈黙はない」と断言してはいけない（観測ゼロと観測不能は別物）
 */
export type SilenceObservation = 'complete' | 'rate-limited' | 'partial';

export type WeatherBroadcastInput = {
  paper: PaperDate;
  /** 紙面の「沈黙の記録」と同じ並び（`listSilent`） */
  silent: readonly SilentRow[];
  /** お気に入り全件の最新信号を取り切れたか（`loadLatestSignals` の結果から決める） */
  observation: SilenceObservation;
  weather: Weather | null;
  rateLimit: RateLimitSnapshot | null;
};

/**
 * 気象通報。API残量の空模様と沈黙の観測を、繰り返し流し続ける定点放送。
 * 紙面では表で一覧できるが、放送では1銘柄1段落でゆっくり読む
 */
export function composeWeatherBroadcast(input: WeatherBroadcastInput): RadioSegment[] {
  const { paper, silent, observation, weather, rateLimit } = input;
  const segments: RadioSegment[] = [
    {
      text: `レポレーダー、気象通報です。${toSpokenDayJa(paper.issuedAtIso)}、六時の観測。`,
      pre: 800,
    },
    rateLimit && weather
      ? {
          text: `コア資源。残量、${rateLimit.remaining}。上限、${rateLimit.limit}。${SKY_READING[weather.sky]}。`,
          pre: 600,
        }
      : { text: 'コア資源。ただいま、観測できません。', pre: 600 },
    { text: '続いて、沈黙の観測です。', pre: 900 },
  ];

  if (silent.length > 0) {
    for (const row of silent) {
      segments.push({
        text:
          `${toSpokenRepo(row.fullName)}。最終信号、${toSpokenTag(row.tagName)}。` +
          `${toSpokenSpan(row.spanLabel)}、無信号。`,
        pre: 600,
      });
    }
    if (observation !== 'complete') {
      segments.push({ text: 'なお、一部の銘柄は、観測できていません。', pre: 600 });
    }
  } else if (observation === 'complete') {
    segments.push({
      text: '本日、沈黙の記録は、ありません。すべての銘柄が、この半年に、信号を発しています。',
      pre: 600,
    });
  } else {
    // 観測できていないのに「沈黙はない」と断言しない（黙って空を返さないのと同じ理由）。
    // 紙面の沈黙欄が観測休止に倒れるときは、放送も休止を告げる
    segments.push({ text: '沈黙の観測は、ただいま、休止しています。', pre: 600 });
  }

  segments.push({ text: '以上、レポレーダー気象通報でした。', pre: 900 });
  return segments;
}

// ---- 局の組み立て ----

function station(
  id: RadioStationId,
  segments: readonly RadioSegment[],
  voice: Pick<
    RadioStation,
    'signal' | 'openingGap' | 'rate' | 'pitch' | 'night' | 'loop' | 'loopGap'
  >
): RadioStation {
  return { ...RADIO_STATION_META[id], ...voice, segments: [...segments] };
}

const VOICE = {
  r1: { signal: 'jihou', openingGap: 4300, rate: 1.02, pitch: 1.0 },
  wx: { signal: null, openingGap: 0, rate: 0.96, pitch: 0.9, loop: true, loopGap: 6000 },
  nb: { signal: 'chime', openingGap: 2800, rate: 0.82, pitch: 0.72, night: true },
} as const satisfies Record<RadioStationId, Parameters<typeof station>[2]>;

/** 当日の放送。素材が揃っている通常系 */
export function buildStations(
  scheduled: ScheduledBroadcastInput,
  weatherReport: WeatherBroadcastInput
): RadioStation[] {
  return [
    station('r1', composeScheduledBroadcast(scheduled), VOICE.r1),
    station('wx', composeWeatherBroadcast(weatherReport), VOICE.wx),
    station('nb', NIGHT_STANDBY_SEGMENTS, VOICE.nb),
  ];
}

/**
 * 縮退時の放送。素材が取れなくても受信機は生きていて、休止を告げる。
 * 深夜便は素材に依存しないため、こちらでも通常どおり休止告知を流す
 */
export function buildOutageStations(): RadioStation[] {
  return [
    station('r1', OUTAGE_SEGMENTS, VOICE.r1),
    station('wx', OUTAGE_SEGMENTS, { ...VOICE.wx, loop: false }),
    station('nb', NIGHT_STANDBY_SEGMENTS, VOICE.nb),
  ];
}
