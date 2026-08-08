'use client';

import { useState, useTransition } from 'react';
import { getReleaseSummary, type ReleaseSummaryResult } from '@/app/actions/summaries';
import styles from '@/components/features/paper/paper.module.css';

/** 生成済みの要約。構造化以前のキャッシュ行では headline / lede が null になる */
type LoadedSummary = Extract<ReleaseSummaryResult, { ok: true }>;

/**
 * AI要約の欄（Issue #41 で囲み引用 .pullquote に組み替え）。
 * 生成はボタン押下でのみ発火し、結果は記事内の囲みとして刷られる
 */
export function ReleaseSummary({
  owner,
  name,
  tagName,
}: {
  owner: string;
  name: string;
  tagName: string;
}) {
  const [summary, setSummary] = useState<LoadedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      setError(null);
      const result = await getReleaseSummary({ owner, name, tagName });
      if (result.ok) {
        setSummary(result);
      } else {
        setError(result.message);
      }
    });
  };

  if (summary !== null) {
    return (
      <div className={styles.pullquote}>
        {summary.hasBreaking && (
          <b>
            <span className={styles.breaking}>【破壊的変更】</span>
          </b>
        )}
        {summary.headline && <b>{summary.headline}</b>}
        {summary.lede && <p>{summary.lede}</p>}
        <p className={styles.preLine}>{summary.summary}</p>
        <small>——AI要約（{tagName}）</small>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={load} disabled={pending} className={styles.stamp}>
        {pending ? '要約を生成中…' : 'AI要約を表示'}
      </button>
      {error && <p className={styles.stopPress}>{error}</p>}
    </div>
  );
}
