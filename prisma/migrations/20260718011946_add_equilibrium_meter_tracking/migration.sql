/*
  Warnings:

  - Added the required column `updatedAt` to the `WorkUnit` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "lastLinkedFollowUpAt" TIMESTAMP(3),
ADD COLUMN     "lastReopenedAt" TIMESTAMP(3),
ADD COLUMN     "linkedFollowUpKeys" TEXT,
ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WorkUnit" ADD COLUMN     "lastReopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Backfill existing rows before enforcing NOT NULL
UPDATE "WorkUnit" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "WorkUnit" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "MeterSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "decomposition" INTEGER NOT NULL,
    "rigor" INTEGER NOT NULL,
    "wip" INTEGER NOT NULL,
    "staleness" INTEGER NOT NULL,
    "churnEvents" INTEGER NOT NULL,
    "overall" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeterSnapshot_date_key" ON "MeterSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_key_key" ON "Badge"("key");
