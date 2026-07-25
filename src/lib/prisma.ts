import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

// 開発時のHMRでPrismaClientが増殖しないようglobalに保持するシングルトン
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
