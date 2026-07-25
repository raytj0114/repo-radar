'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { getReleaseSummary } from '@/app/actions/summaries';

export function ReleaseSummary({
  owner,
  name,
  tagName,
}: {
  owner: string;
  name: string;
  tagName: string;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      setError(null);
      const result = await getReleaseSummary({ owner, name, tagName });
      if (result.ok) {
        setSummary(result.summary);
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
        <p className="whitespace-pre-line text-sm text-gray-800">{summary}</p>
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
