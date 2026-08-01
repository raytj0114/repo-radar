-- AlterTable
ALTER TABLE "ReleaseSummary" ADD COLUMN     "hasBreaking" BOOLEAN,
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "lede" TEXT,
ADD COLUMN     "promptVersion" INTEGER NOT NULL DEFAULT 1;
