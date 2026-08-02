-- CreateTable
CREATE TABLE "RepoStarSnapshot" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoStarSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoStarSnapshot_fullName_date_key" ON "RepoStarSnapshot"("fullName", "date");
