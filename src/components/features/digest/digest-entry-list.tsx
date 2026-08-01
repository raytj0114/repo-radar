import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { composeDigestOverview, type DigestEntry } from '@/lib/digest';
import { formatDateJa } from '@/lib/format';

/**
 * 朝刊エントリのカード一覧。冒頭の総括（ルールベース）と、
 * リポジトリ詳細へのリンク付きカードを並べる。本格的な紙面組版は Issue #31 で行う。
 */
export function DigestEntryList({ entries }: { entries: DigestEntry[] }) {
  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">{composeDigestOverview(entries)}</p>
      <ol className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={`${entry.fullName}@${entry.tagName}`}>
            <Link
              href={`/repos/${entry.owner}/${entry.repo}`}
              className="block rounded-md border border-gray-200 p-3 hover:border-gray-300 hover:bg-gray-50"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="max-w-full truncate text-sm font-medium">{entry.fullName}</span>
                <span className="max-w-full truncate text-sm text-gray-700">
                  {entry.releaseName ?? entry.tagName}
                </span>
                {entry.hasBreaking && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <AlertTriangle size={12} />
                    破壊的変更
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {entry.tagName} ・ {formatDateJa(entry.publishedAt)}
              </p>
              {entry.headline && (
                <p className="mt-1.5 text-sm font-bold text-gray-900">{entry.headline}</p>
              )}
              {entry.summary ? (
                <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{entry.summary}</p>
              ) : (entry.noteless ?? true) ? (
                // noteless欠落（#36以前のエントリ）は区別できないため従来表示に倒す
                <p className="mt-1 text-sm text-gray-400">リリースノートなし</p>
              ) : (
                // 生成失敗。共有要約プールに行が無いままなので、翌日のバックフィルで自動再試行される
                <p className="mt-1 text-sm text-gray-400">要約を生成できませんでした</p>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
