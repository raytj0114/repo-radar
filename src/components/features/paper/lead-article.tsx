import Link from 'next/link';
import type { DigestEntry } from '@/lib/digest';
import styles from './paper.module.css';

/** 要約（・区切りの複数行）を記事の段落に起こす。行頭の「・」を落とし、句点で結ぶ */
function summaryParagraphs(summary: string | null): string[] {
  if (!summary) return [];
  return summary
    .split('\n')
    .map((line) => line.replace(/^・/, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => (/[。．！？]$/.test(line) ? line : `${line}。`));
}

/** 要約が無いエントリの地の文。noteless の意味は digest.ts の定義に従う */
function fallbackParagraph(entry: DigestEntry): string {
  return (entry.noteless ?? true)
    ? 'このリリースにノートは無い。着信の事実のみを報じる。'
    : '要約は組版に間に合わなかった。明朝の版までに補われる見込みである。';
}

/**
 * 一面トップ。headline が無い旧キャッシュはタグ名を見出し代わりにする（Issue #31 注記）。
 * lede（前文）があればドロップキャップ付きの導入段落として組む
 */
export function LeadArticle({ entry }: { entry: DigestEntry }) {
  const paragraphs = summaryParagraphs(entry.summary);
  return (
    <article>
      <h2 className={styles.leadHd}>
        <Link href={`/repos/${entry.owner}/${entry.repo}`}>
          {entry.headline ?? `${entry.repo}　${entry.tagName}`}
        </Link>
      </h2>
      <p className={styles.leadSub}>
        {entry.fullName}　{entry.tagName}
        {entry.hasBreaking === true && <span className={styles.breaking}>　【破壊的変更】</span>}
      </p>
      <div className={styles.leadBody}>
        {entry.lede ? <p className={styles.lede}>{entry.lede}</p> : null}
        {paragraphs.length > 0 ? (
          paragraphs.map((line, index) => <p key={index}>{line}</p>)
        ) : (
          <p>{fallbackParagraph(entry)}</p>
        )}
        {entry.summary !== null && <p className={styles.byline}>（観測員）</p>}
      </div>
    </article>
  );
}

/** 二番手記事。一面より一回り小さい見出しで、右に短信を従える */
export function SecondArticle({ entry }: { entry: DigestEntry }) {
  const paragraphs = summaryParagraphs(entry.summary);
  return (
    <article className={styles.article}>
      <span className={styles.kanban}>二番手</span>
      <h3 className={styles.smallHd}>
        <Link href={`/repos/${entry.owner}/${entry.repo}`}>
          {entry.headline ?? `${entry.repo}　${entry.tagName}`}
        </Link>
        <small>
          {entry.fullName}　{entry.tagName}
          {entry.hasBreaking === true && <span className={styles.breaking}>　【破壊的変更】</span>}
        </small>
      </h3>
      {entry.lede ? <p>{entry.lede}</p> : null}
      {paragraphs.length > 0 ? (
        paragraphs.map((line, index) => <p key={index}>{line}</p>)
      ) : (
        <p>{fallbackParagraph(entry)}</p>
      )}
    </article>
  );
}

/**
 * 一面の休載（当日の朝刊が無い日）。紙面の枠組みは保ったまま静かな朝を報じる。
 * 朝刊行の不在は「静かな夜」と「配達事故（cron失敗。翌日のバックフィルで自己修復）」を
 * 区別できないため、文言はどちらでも真になる「載らなかった」で組む
 */
export function LeadHoliday({ hasFavorites }: { hasFavorites: boolean }) {
  return (
    <article>
      <h2 className={styles.leadHd}>本日、一面に報じる新規リリースなし</h2>
      <p className={styles.leadSub}>静かな朝である</p>
      <div className={styles.kyusai}>
        {hasFavorites ? (
          '昨夜六時締めの朝刊に新しい信号は載らなかった。短信・相場・沈黙の各欄は平常どおり観測を続けている。'
        ) : (
          <>
            観測銘柄が未登録のため一面は休載。
            <Link href="/favorites">購読面</Link>から銘柄を登録すると、翌朝から紙面が組まれる。
          </>
        )}
      </div>
    </article>
  );
}
