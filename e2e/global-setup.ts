import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { dailyDigestKey } from '@/lib/github/cache-key';
import {
  E2E_DATABASE_URL,
  E2E_DIGEST,
  E2E_DIGEST_ENTRIES,
  E2E_FAVORITES,
  E2E_GITHUB_ACCOUNT,
  E2E_STAR_SNAPSHOTS,
  E2E_TODAY_DIGEST_ENTRIES,
  E2E_USER,
  e2eDigestDay,
} from './constants';

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

    // 購読面（Issue #42）の星取帳は Account.providerAccountId からloginを解決するため、
    // GitHubプロバイダのAccount行が必須（実運用ではAuth.jsのadapterが初回ログイン時に作る行）
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'github',
          providerAccountId: E2E_GITHUB_ACCOUNT.providerAccountId,
        },
      },
      create: {
        userId: E2E_USER.id,
        type: 'oauth',
        provider: 'github',
        providerAccountId: E2E_GITHUB_ACCOUNT.providerAccountId,
      },
      update: { userId: E2E_USER.id },
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

    await prisma.dailyDigest.deleteMany({ where: { userId: E2E_USER.id } });

    // 旧形式（contentのみ）: 朝刊化以前の行の表示互換を検証する
    const digestDate = new Date(`${E2E_DIGEST.date}T00:00:00Z`);
    await prisma.dailyDigest.create({
      data: {
        cacheKey: dailyDigestKey(digestDate, E2E_USER.id),
        userId: E2E_USER.id,
        date: digestDate,
        content: E2E_DIGEST.content,
        model: 'e2e-seed',
      },
    });

    // 朝刊形式（entries）: カード表示・総括・破壊的変更バッジ・「リリースノートなし」を検証する
    const entriesDate = new Date(`${E2E_DIGEST_ENTRIES.date}T00:00:00Z`);
    await prisma.dailyDigest.create({
      data: {
        cacheKey: dailyDigestKey(entriesDate, E2E_USER.id),
        userId: E2E_USER.id,
        date: entriesDate,
        entries: E2E_DIGEST_ENTRIES.entries,
      },
    });

    // 当日の朝刊（紙面の一面・二番手を検証する。Issue #31）。
    // 当日窓に加えて翌日窓もシードし、セットアップとテスト実行の間に
    // 21:00 UTC境界を跨いでも一面が休載へ落ちない決定的な状態にする
    for (const dayOffset of [0, 1]) {
      const day = e2eDigestDay(dayOffset);
      const date = new Date(`${day}T00:00:00Z`);
      await prisma.dailyDigest.create({
        data: {
          cacheKey: dailyDigestKey(date, E2E_USER.id),
          userId: E2E_USER.id,
          date,
          entries: E2E_TODAY_DIGEST_ENTRIES,
        },
      });
    }

    // 相場欄の前日比（Issue #40）。実運用ではcronだけが書く表なので、E2Eでは
    // 「採取済みの数日ぶん」をここで作る（前日比・欠測を挟む直近観測比・履歴なしの三態）
    await prisma.repoStarSnapshot.deleteMany({
      where: { fullName: { in: E2E_STAR_SNAPSHOTS.map((snapshot) => snapshot.fullName) } },
    });
    await prisma.repoStarSnapshot.createMany({
      data: E2E_STAR_SNAPSHOTS.map(({ fullName, dayOffset, stars }) => ({
        fullName,
        stars,
        date: new Date(`${e2eDigestDay(dayOffset)}T00:00:00Z`),
      })),
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default async function globalSetup(): Promise<void> {
  migrate();
  await seed();
}
