import { fetchStarredRepositories, fetchUserLogin } from '@/lib/github/client';
import type { Repository } from '@/lib/github/schemas';
import { prisma } from '@/lib/prisma';

/**
 * GitHubスター一覧の取得口（Issue #42）。購読面の表示と取り込みServer Actionの両方が
 * ここを通る。取得パラメータを共有することが本質的に重要: `fetchUserLogin` /
 * `fetchStarredRepositories` のURLとrevalidateが一致していればNextのData Cacheに
 * 相乗りでき、「画面を開いてから取り込む」一連の操作でGitHubへの実リクエストが増えない。
 * 経路を分けた瞬間、取り込みのたびに最大4リクエスト（login解決+3ページ）が再発する。
 *
 * ユーザーのOAuthトークンは使わない（ARCHITECTURE.md の設計制約）。サーバーPATで
 * 公開スターのみを読む。loginはセッションのJWTに無いため、Account.providerAccountId
 * （GitHubの数値ID）から解決する。
 */

export type StarredLookup =
  /** 取得成功。reposは新しい順・最大 STARRED_IMPORT_MAX 件 */
  | { status: 'ok'; login: string; repos: Repository[] }
  /** GitHubのAccount行が無い（想定外のデータ状態。再ログインでAuth.jsが再リンクする） */
  | { status: 'no-account' }
  /** 数値ID→login解決かスター一覧が404（GitHub側のアカウント消滅・改名直後） */
  | { status: 'login-missing' };

/**
 * セッションのuserIdからスター一覧を引く。レート上限（GitHubRateLimitError）や
 * その他のGitHub障害はthrowのまま伝播させ、呼び出し側が settle/unwrapSettled で
 * 欄単位の縮退に落とす（黙って空配列にしない）
 */
export async function loadStarredForUser(userId: string): Promise<StarredLookup> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'github' },
    select: { providerAccountId: true },
  });
  if (!account) return { status: 'no-account' };

  const login = await fetchUserLogin(account.providerAccountId);
  if (login === null) return { status: 'login-missing' };

  const repos = await fetchStarredRepositories(login);
  if (repos === null) return { status: 'login-missing' };

  return { status: 'ok', login, repos };
}
