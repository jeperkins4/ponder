-- AlterTable
ALTER TABLE "WorkUnit" ADD COLUMN     "acceptanceCriteria" TEXT,
ADD COLUMN     "verification" TEXT;

-- CreateTable
CREATE TABLE "WorkNote" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkNote_workUnitId_idx" ON "WorkNote"("workUnitId");

-- AddForeignKey
ALTER TABLE "WorkNote" ADD CONSTRAINT "WorkNote_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "WorkUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
