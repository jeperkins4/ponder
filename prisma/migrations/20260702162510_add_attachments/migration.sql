-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_workUnitId_idx" ON "Attachment"("workUnitId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "WorkUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
