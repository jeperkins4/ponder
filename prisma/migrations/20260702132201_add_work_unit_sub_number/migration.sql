-- AlterTable
ALTER TABLE "WorkUnit" ADD COLUMN     "subNumber" INTEGER;

-- Backfill: assign a stable 1-based sub-number per story, ordered by
-- creation time (id as tiebreak), but only for stories that were actually
-- decomposed into more than one work unit. Single-unit stories stay NULL
-- so their cards keep rendering the bare parent JIRA key.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "storyId" ORDER BY "createdAt", id) AS rn,
         COUNT(*)     OVER (PARTITION BY "storyId") AS cnt
  FROM "WorkUnit"
)
UPDATE "WorkUnit" w SET "subNumber" = r.rn
FROM ranked r WHERE w.id = r.id AND r.cnt > 1;
