// リポジトリの同一性キー（純関数のみ。prisma / github / env に依存しない）。
// 保存側（星数スナップショット）と表示側（紙面の相場欄）が**同じ1関数**で突き合わせるための出所。
// 規則が片方だけ変わると、前日比が「履歴の無い銘柄」として静かに欠ける（型にもテストにも出ない）。

/**
 * `owner/repo` 形式の同一性キー。GitHubは owner/repo を大小非区別で扱うため、
 * 小文字化しても情報を失わずケース違い（例: "Vercel/Next.js"）を同一視できる。
 * `src/lib/digest.ts` の repoKeyOf・`src/lib/github/cache-key.ts` の正規化と同じ規則。
 */
export function normalizeFullName(fullName: string): string {
  return fullName.trim().toLowerCase();
}
