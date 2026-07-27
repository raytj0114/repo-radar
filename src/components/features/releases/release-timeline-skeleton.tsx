// ReleaseTimeline のストリーミング中フォールバック。
// 行の構造・高さを本体（release-timeline.tsx）と揃え、実データ差し替え時のレイアウトシフトを避ける。

/** 実データの平均的な件数に近く、375px幅でも1画面に収まる行数 */
const SKELETON_ROWS = 5;

export function ReleaseTimelineSkeleton() {
  return (
    <div
      className="divide-y divide-gray-100"
      role="status"
      aria-busy="true"
      aria-label="リリースを読み込み中"
    >
      {[...Array(SKELETON_ROWS)].map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-4">
          <div className="mt-0.5 h-8 w-8 shrink-0 animate-pulse rounded-full bg-gray-200" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
