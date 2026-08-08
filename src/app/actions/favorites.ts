'use server';

import { revalidatePath } from 'next/cache';
import { addFavoriteInputSchema, favoriteTargetSchema } from '@/lib/favorite-input';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';
import { loadStarredForUser, type StarredLookup } from '@/lib/starred';
import { importStarredInputSchema, type ImportStarredResult } from '@/lib/subscription-input';

/**
 * お気に入り変更が映る面だけを失効させる（#42レビュー指摘3）。
 * `revalidatePath('/', 'layout')` は全ルートのfetchエントリが持つ暗黙タグ `_N_T_/layout` を
 * 失効させ、action応答の再レンダーが無関係な画面のGitHubキャッシュ（login解決・スター一覧・
 * 検索）まで再取得していた。列挙した面のfetchキャッシュは依然トグル毎に失効する
 * （例: /favorites?star=1 上の取り込みはスター一覧を再取得する）が、それは表示の正しさに
 * 必要なコスト。/radio はお気に入り→最新リリース（loadLatestSignals）で放送原稿を組むため含める
 */
function revalidateFavoriteViews(): void {
  revalidatePath('/');
  revalidatePath('/favorites');
  revalidatePath('/trending');
  revalidatePath('/radio');
  revalidatePath('/repos/[owner]/[name]', 'page');
}

/** お気に入り登録。重複登録はupsertで安全に無視する */
export async function addFavorite(input: unknown): Promise<void> {
  const session = await requireSession();
  const { owner, name, avatarUrl } = addFavoriteInputSchema.parse(input);
  await prisma.favoriteRepo.upsert({
    where: { userId_owner_name: { userId: session.user.id, owner, name } },
    create: {
      userId: session.user.id,
      owner,
      name,
      fullName: `${owner}/${name}`,
      avatarUrl: avatarUrl ?? null,
    },
    update: {},
  });
  revalidateFavoriteViews();
}

/**
 * GitHubスターからの選択式取り込み（Issue #42 購読面）。
 * クライアントから受け取るのはリポジトリの数値IDのみで、保存する owner/name/avatarUrl は
 * サーバー側で取得し直したスター一覧（canonical casing）から引く。
 * スター一覧の取得は購読面の表示と同一パラメータ（`loadStarredForUser`）なので、
 * 直前の画面表示で温まったData Cacheに相乗りし、GitHubへの実リクエストは通常増えない。
 * 失敗はthrowせず型付き結果で返す（面ごとerror境界に落とさない。#42レビュー指摘2）
 */
export async function importStarredFavorites(input: unknown): Promise<ImportStarredResult> {
  const session = await requireSession();
  const parsed = importStarredInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid-input' };
  }

  // 黙って空成功にしない: 画面でスター一覧が見えているのに取り込みだけ静かに消える、を防ぐ。
  // レート上限等の例外も「星取帳が引けなかった」として同じ縮退に丸める（原文はログのみ）
  let lookup: StarredLookup;
  try {
    lookup = await loadStarredForUser(session.user.id);
  } catch (error) {
    console.error('[favorites] importStarredFavorites: starred lookup failed', error);
    return { ok: false, reason: 'starred-unavailable' };
  }
  if (lookup.status !== 'ok') {
    return { ok: false, reason: 'starred-unavailable' };
  }

  const idSet = new Set(parsed.data.ids);
  const selected = lookup.repos.filter((repo) => idSet.has(repo.id));
  // スター一覧に無いidは黙って捨てる（表示後にGitHub側で星が外れた等。選択済み分だけ登録する）
  if (selected.length > 0) {
    // addFavoriteのupsert（update:{}）と同じ「既存行は変更しない」冪等セマンティクスを1クエリで
    await prisma.favoriteRepo.createMany({
      data: selected.map((repo) => ({
        userId: session.user.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        avatarUrl: repo.owner.avatar_url,
      })),
      skipDuplicates: true,
    });
  }
  revalidateFavoriteViews();
  return { ok: true };
}

/** お気に入り解除。未登録でもエラーにしない（冪等） */
export async function removeFavorite(input: unknown): Promise<void> {
  const session = await requireSession();
  const { owner, name } = favoriteTargetSchema.parse(input);
  await prisma.favoriteRepo.deleteMany({
    where: { userId: session.user.id, owner, name },
  });
  revalidateFavoriteViews();
}
