-- AlterTable
ALTER TABLE "WorkUnit" ADD COLUMN     "verificationOutcome" TEXT,
ADD COLUMN     "verificationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "verificationSummary" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);
