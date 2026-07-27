import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { dailyDigestKey } from '@/lib/github/cache-key';
import { E2E_DATABASE_URL, E2E_DIGEST, E2E_FAVORITES, E2E_USER } from './constants';

// E2E専用DBを用意し、決定的なシードデータを流し込む（Issue #16 論点3）。
// 開発用DBとは別のデータベースを使うため、何度流しても開発中のデータを壊さない。

function migrate(): void {
  // db push は禁止（CLAUDE.md 不変条件4）。マイグレーション履歴をそのまま適用する。
  // DBが存在しない場合は prisma migrate deploy が作成する
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, DIRECT_URL: E2E_DATABASE_URL },
  });
}

async function seed(): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
  try {
    await prisma.user.upsert({
      where: { id: E2E_USER.id },
      create: { id: E2E_USER.id, name: E2E_USER.name, email: E2E_USER.email },
      update: { name: E2E_USER.name, email: E2E_USER.email },
    });

    // 前回実行の残骸を消してから入れ直す。件数を数えるアサーションを成立させるため
    await prisma.favoriteRepo.deleteMany({ where: { userId: E2E_USER.id } });
    await prisma.favoriteRepo.createMany({
      data: E2E_FAVORITES.map(({ owner, name }) => ({
        userId: E2E_USER.id,
        owner,
        name,
        fullName: `${owner}/${name}`,
        // next/imageの最適化経由で外部へ画像を取りに行かせない
        avatarUrl: null,
      })),
    });

    const digestDate = new Date(`${E2E_DIGEST.date}T00:00:00Z`);
    await prisma.dailyDigest.deleteMany({ where: { userId: E2E_USER.id } });
    await prisma.dailyDigest.create({
      data: {
        cacheKey: dailyDigestKey(digestDate, E2E_USER.id),
        userId: E2E_USER.id,
        date: digestDate,
        content: E2E_DIGEST.content,
        model: 'e2e-seed',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default async function globalSetup(): Promise<void> {
  migrate();
  await seed();
}
