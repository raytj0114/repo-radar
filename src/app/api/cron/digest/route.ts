import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { generateDailyDigest } from '@/lib/digest';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';

// 公開エンドポイント（docs/ARCHITECTURE.md「公開エンドポイント一覧」に記載済み）。
// Vercel Cron からのみ呼ばれる想定で、CRON_SECRET のBearer検証で保護する。

export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (header === null) return false;
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await prisma.favoriteRepo.findMany({
    distinct: ['userId'],
    select: { userId: true },
  });

  const now = new Date();
  const counts: Record<string, number> = {
    generated: 0,
    cached: 0,
    'no-activity': 0,
    'no-favorites': 0,
    failed: 0,
  };
  for (const { userId } of users) {
    try {
      counts[await generateDailyDigest(userId, now)] += 1;
    } catch (error) {
      counts.failed += 1;
      console.error(`[digest] generation failed userId=${userId}:`, error);
    }
  }

  return NextResponse.json({ date: now.toISOString().slice(0, 10), users: users.length, counts });
}
