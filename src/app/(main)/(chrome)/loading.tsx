export default function MainLoading() {
  return (
    <div
      className="flex flex-col gap-3 py-8"
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
    >
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}
