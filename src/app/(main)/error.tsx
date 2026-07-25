'use client';

export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="font-medium text-gray-900">問題が発生しました</p>
      <p className="max-w-md text-sm text-gray-500">
        データの取得に失敗しました。時間をおいて再試行してください。
      </p>
      {error.digest && <p className="text-xs text-gray-400">エラーID: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        再試行
      </button>
    </div>
  );
}
