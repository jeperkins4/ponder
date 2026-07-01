-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "jiraKey" TEXT NOT NULL,
    "jiraId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "jiraStatus" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "completionCommentPostedAt" TIMESTAMP(3),

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkUnit" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "column" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_jiraKey_key" ON "Story"("jiraKey");

-- CreateIndex
CREATE UNIQUE INDEX "Story_jiraId_key" ON "Story"("jiraId");

-- AddForeignKey
ALTER TABLE "WorkUnit" ADD CONSTRAINT "WorkUnit_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
