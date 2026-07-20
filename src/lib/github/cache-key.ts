/**
 * AIキャッシュのキー生成。ここを唯一の生成箇所とし、直書きを禁止する。
 * 形式を変える場合は既存キャッシュとの互換に注意（docs/ARCHITECTURE.md 参照）。
 */

export function releaseSummaryKey(owner: string, repo: string, tagName: string): string {
  return `${normalize(owner)}/${normalize(repo)}@${tagName.trim()}`;
}

export function dailyDigestKey(date: Date, userId: string): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `digest:${yyyy}-${mm}-${dd}:${userId}`;
}

function normalize(segment: string): string {
  return segment.trim().toLowerCase();
}
