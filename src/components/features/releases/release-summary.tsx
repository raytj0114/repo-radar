'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { getReleaseSummary, type ReleaseSummaryResult } from '@/app/actions/summaries';

/** 生成済みの要約。構造化以前のキャッシュ行では headline / lede が null になる */
type LoadedSummary = Extract<ReleaseSummaryResult, { ok: true }>;

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
      <div className="mt-3 rounded-md bg-indigo-50 px-3 py-2">
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-indigo-700">
          <Sparkles size={12} />
          AI要約
        </p>
        {(summary.hasBreaking || summary.headline) && (
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {summary.hasBreaking && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                <AlertTriangle size={12} />
                破壊的変更
              </span>
            )}
            {summary.headline && (
              <p className="text-sm font-bold text-gray-900">{summary.headline}</p>
            )}
          </div>
        )}
        {summary.lede && <p className="mb-1 text-sm text-gray-700">{summary.lede}</p>}
        <p className="whitespace-pre-line text-sm text-gray-800">{summary.summary}</p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={load}
        disabled={pending}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline disabled:opacity-50"
      >
        <Sparkles size={14} />
        {pending ? '要約を生成中…' : 'AI要約を表示'}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
