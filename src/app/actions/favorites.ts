'use server';

import { revalidatePath } from 'next/cache';
import { addFavoriteInputSchema, favoriteTargetSchema } from '@/lib/favorite-input';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';
import { loadStarredForUser } from '@/lib/starred';
import { importStarredInputSchema } from '@/lib/subscription-input';

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
  // お気に入り状態は全画面（ダッシュボード/トレンド/詳細）に影響する
  revalidatePath('/', 'layout');
}

/**
 * GitHubスターからの選択式取り込み（Issue #42 購読面）。
 * クライアントから受け取るのはリポジトリの数値IDのみで、保存する owner/name/avatarUrl は
 * サーバー側で取得し直したスター一覧（canonical casing）から引く。
 * スター一覧の取得は購読面の表示と同一パラメータ（`loadStarredForUser`）なので、
 * 直前の画面表示で温まったData Cacheに相乗りし、GitHubへの実リクエストは通常増えない。
 */
export async function importStarredFavorites(input: unknown): Promise<void> {
  const session = await requireSession();
  const { ids } = importStarredInputSchema.parse(input);

  const lookup = await loadStarredForUser(session.user.id);
  if (lookup.status !== 'ok') {
    // 黙って空成功にしない: 画面でスター一覧が見えているのに取り込みだけ静かに消える、を防ぐ
    throw new Error('GitHubのスター一覧を取得できませんでした');
  }

  const idSet = new Set(ids);
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
  revalidatePath('/', 'layout');
}

/** お気に入り解除。未登録でもエラーにしない（冪等） */
export async function removeFavorite(input: unknown): Promise<void> {
  const session = await requireSession();
  const { owner, name } = favoriteTargetSchema.parse(input);
  await prisma.favoriteRepo.deleteMany({
    where: { userId: session.user.id, owner, name },
  });
  revalidatePath('/', 'layout');
}
