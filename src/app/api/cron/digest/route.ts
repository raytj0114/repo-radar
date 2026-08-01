import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDailyDigest } from '@/lib/digest';
import { env } from '@/lib/env';

// 公開エンドポイント（docs/ARCHITECTURE.md「公開エンドポイント一覧」に記載済み）。
// Vercel Cron からのみ呼ばれる想定で、CRON_SECRET のBearer検証で保護する。

// Fluid compute前提の上限（Hobbyは300秒まで）。デプロイがプラン上限エラーになる場合は60へ戻し、
// 前日バックフィル（runDailyDigest）をタイムアウト時の回復手段とする
export const maxDuration = 300;

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
  return NextResponse.json(await runDailyDigest(new Date()));
}
