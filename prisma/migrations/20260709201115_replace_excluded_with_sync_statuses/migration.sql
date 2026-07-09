-- AlterTable
ALTER TABLE "Project" DROP COLUMN "jiraExcludedStatuses";
ALTER TABLE "Project" ADD COLUMN "jiraSyncStatuses" TEXT DEFAULT 'To Do, In Progress, Code Revew, Code Review';
