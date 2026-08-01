-- AlterTable
ALTER TABLE "DailyDigest" ADD COLUMN     "entries" JSONB,
ALTER COLUMN "content" DROP NOT NULL,
ALTER COLUMN "model" DROP NOT NULL;
