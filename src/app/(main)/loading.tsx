export default function MainLoading() {
  return (
    <div className="flex flex-col gap-3 py-8" aria-label="読み込み中" role="status">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}
