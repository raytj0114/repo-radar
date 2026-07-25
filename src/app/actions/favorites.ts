'use server';

import { revalidatePath } from 'next/cache';
import { addFavoriteInputSchema, favoriteTargetSchema } from '@/lib/favorite-input';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';

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

/** お気に入り解除。未登録でもエラーにしない（冪等） */
export async function removeFavorite(input: unknown): Promise<void> {
  const session = await requireSession();
  const { owner, name } = favoriteTargetSchema.parse(input);
  await prisma.favoriteRepo.deleteMany({
    where: { userId: session.user.id, owner, name },
  });
  revalidatePath('/', 'layout');
}
