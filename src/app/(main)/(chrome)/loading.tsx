/**
 * (chrome)配下の共通スケルトン。
 *
 * **注意**: `loading.tsx` はセグメント単位のSuspense境界になる。この配下の
 * `/trending` と `/repos/[owner]/[name]` は同一ページのServer Action（購読トグル）を持つため、
 * `docs/ARCHITECTURE.md` の「レンダリング制約」に**既に違反している**状態にある
 * （Issue #47 の実測でHTTP/1.1環境では 7〜12/20 しかUIが更新されない。
 * 本番のVercelはHTTP/2で20/20のため露見していない）。
 * このファイルを消す/動かす前に、購読トグル往復のE2Eを足して落ちることを確認すること
 */
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
