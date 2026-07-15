# Codebase Map

Generated: 2026-07-12T17:02:23Z | Files: 216 | Described: 0/216
<!-- gsd:codebase-meta {"generatedAt":"2026-07-12T17:02:23Z","fingerprint":"13f79ba18a30da7fd26536853e0645a99cf3ea15","fileCount":216,"truncated":false} -->

### (root)/
- *(21 files: 5 .md, 5 .ts, 4 .json, 2 .js, 1 .example, 1 .test, 1 (no ext), 1 .yml, 1 .mjs)*

### .github/workflows/
- `.github/workflows/ci.yml`

### docker/
- `docker/init-test-db.sh`

### docs/
- `docs/understand-anything-integration.md`

### docs/superpowers/plans/
- `docs/superpowers/plans/2026-06-30-jira-kanban-implementation.md`
- `docs/superpowers/plans/2026-07-01-ai-assisted-import.md`
- `docs/superpowers/plans/2026-07-01-kanban-redesign.md`
- `docs/superpowers/plans/2026-07-01-ponder-mcp-server.md`
- `docs/superpowers/plans/2026-07-02-mcp-attach-image.md`
- `docs/superpowers/plans/2026-07-02-mcp-graph-enrichment.md`
- `docs/superpowers/plans/2026-07-03-archive-on-move-to-qa.md`
- `docs/superpowers/plans/2026-07-03-board-visual-refresh.md`
- `docs/superpowers/plans/2026-07-03-move-to-qa-button.md`
- `docs/superpowers/plans/2026-07-04-per-card-move-to-qa.md`
- `docs/superpowers/plans/2026-07-04-reimport-dedup.md`
- `docs/superpowers/plans/2026-07-04-verify-button.md`
- `docs/superpowers/plans/2026-07-05-reporting-suite.md`
- `docs/superpowers/plans/2026-07-06-pr-gated-completion.md`
- `docs/superpowers/plans/2026-07-06-report-trends.md`
- `docs/superpowers/plans/2026-07-09-legacy-v1-purge.md`
- `docs/superpowers/plans/2026-07-09-status-category-mapping.md`

### docs/superpowers/specs/
- `docs/superpowers/specs/2026-06-30-jira-kanban-design.md`
- `docs/superpowers/specs/2026-07-04-per-card-move-to-qa-design.md`
- `docs/superpowers/specs/2026-07-04-reimport-dedup-design.md`
- `docs/superpowers/specs/2026-07-04-verify-button-design.md`
- `docs/superpowers/specs/2026-07-05-pr-gated-completion-design.md`
- `docs/superpowers/specs/2026-07-05-reporting-suite-design.md`
- `docs/superpowers/specs/2026-07-06-report-trends-design.md`
- `docs/superpowers/specs/2026-07-09-legacy-v1-purge-design.md`
- `docs/superpowers/specs/2026-07-09-status-category-mapping-design.md`

### prisma/
- `prisma/schema.prisma`

### prisma/migrations/
- `prisma/migrations/migration_lock.toml`

### prisma/migrations/20260701015544_init/
- `prisma/migrations/20260701015544_init/migration.sql`

### prisma/migrations/20260701145937_add_project_table/
- `prisma/migrations/20260701145937_add_project_table/migration.sql`

### prisma/migrations/20260701172900_add_project_jira_credentials/
- `prisma/migrations/20260701172900_add_project_jira_credentials/migration.sql`

### prisma/migrations/20260702124951_add_ac_verification_and_worknotes/
- `prisma/migrations/20260702124951_add_ac_verification_and_worknotes/migration.sql`

### prisma/migrations/20260702132201_add_work_unit_sub_number/
- `prisma/migrations/20260702132201_add_work_unit_sub_number/migration.sql`

### prisma/migrations/20260702162510_add_attachments/
- `prisma/migrations/20260702162510_add_attachments/migration.sql`

### prisma/migrations/20260703222511_add_work_unit_archived_at/
- `prisma/migrations/20260703222511_add_work_unit_archived_at/migration.sql`

### prisma/migrations/20260704135832_add_work_unit_verification_fields/
- `prisma/migrations/20260704135832_add_work_unit_verification_fields/migration.sql`

### prisma/migrations/20260704160453_add_work_unit_moved_to_qa_reported_at/
- `prisma/migrations/20260704160453_add_work_unit_moved_to_qa_reported_at/migration.sql`

### prisma/migrations/20260706082347_add_project_github_repos/
- `prisma/migrations/20260706082347_add_project_github_repos/migration.sql`

### prisma/migrations/20260709191121_add_project_jira_excluded_statuses/
- `prisma/migrations/20260709191121_add_project_jira_excluded_statuses/migration.sql`

### prisma/migrations/20260709201115_replace_excluded_with_sync_statuses/
- `prisma/migrations/20260709201115_replace_excluded_with_sync_statuses/migration.sql`

### scripts/
- `scripts/backfill-ac-verification.ts`
- `scripts/clear-project-stories.mjs`
- `scripts/seed-demo.mjs`

### src/
- `src/globals.d.ts`

### src/app/
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/not-found.tsx`
- `src/app/page.test.tsx`
- `src/app/page.tsx`

### src/app/api/
- `src/app/api/work-units.test.ts`

### src/app/api/attachments/[id]/
- `src/app/api/attachments/[id]/route.test.ts`
- `src/app/api/attachments/[id]/route.ts`

### src/app/api/projects/
- `src/app/api/projects/route.test.ts`
- `src/app/api/projects/route.ts`

### src/app/api/projects/[projectId]/
- `src/app/api/projects/[projectId]/route.ts`

### src/app/api/projects/[projectId]/import/preview/
- `src/app/api/projects/[projectId]/import/preview/route.test.ts`
- `src/app/api/projects/[projectId]/import/preview/route.ts`

### src/app/api/projects/[projectId]/import/process/
- `src/app/api/projects/[projectId]/import/process/route.test.ts`
- `src/app/api/projects/[projectId]/import/process/route.ts`

### src/app/api/projects/[projectId]/sync/
- `src/app/api/projects/[projectId]/sync/route.test.ts`
- `src/app/api/projects/[projectId]/sync/route.ts`

### src/app/api/projects/[projectId]/test-connection/
- `src/app/api/projects/[projectId]/test-connection/route.test.ts`
- `src/app/api/projects/[projectId]/test-connection/route.ts`

### src/app/api/reports/
- `src/app/api/reports/route.test.ts`
- `src/app/api/reports/route.ts`

### src/app/api/stories/
- `src/app/api/stories/route.test.ts`
- `src/app/api/stories/route.ts`

### src/app/api/work-units/
- `src/app/api/work-units/route.ts`

### src/app/api/work-units/[id]/
- `src/app/api/work-units/[id]/move.test.ts`
- `src/app/api/work-units/[id]/route.ts`

### src/app/api/work-units/[id]/attachments/
- `src/app/api/work-units/[id]/attachments/route.test.ts`
- `src/app/api/work-units/[id]/attachments/route.ts`

### src/app/api/work-units/[id]/generate-acceptance-criteria/
- `src/app/api/work-units/[id]/generate-acceptance-criteria/route.test.ts`
- `src/app/api/work-units/[id]/generate-acceptance-criteria/route.ts`

### src/app/api/work-units/[id]/move/
- `src/app/api/work-units/[id]/move/route.ts`

### src/app/api/work-units/[id]/move-to-qa/
- `src/app/api/work-units/[id]/move-to-qa/route.test.ts`
- `src/app/api/work-units/[id]/move-to-qa/route.ts`

### src/app/api/work-units/[id]/notes/
- `src/app/api/work-units/[id]/notes/route.test.ts`
- `src/app/api/work-units/[id]/notes/route.ts`

### src/app/api/work-units/[id]/report-verification/
- `src/app/api/work-units/[id]/report-verification/route.test.ts`
- `src/app/api/work-units/[id]/report-verification/route.ts`

### src/app/api/work-units/[id]/request-verification/
- `src/app/api/work-units/[id]/request-verification/route.test.ts`
- `src/app/api/work-units/[id]/request-verification/route.ts`

### src/app/api/work-units/reorder/
- `src/app/api/work-units/reorder/route.test.ts`
- `src/app/api/work-units/reorder/route.ts`

### src/app/projects/
- `src/app/projects/page.test.tsx`
- `src/app/projects/page.tsx`

### src/app/projects/[projectId]/board/
- `src/app/projects/[projectId]/board/page.integration.test.tsx`
- `src/app/projects/[projectId]/board/page.test.tsx`
- `src/app/projects/[projectId]/board/page.tsx`

### src/app/projects/[projectId]/settings/
- `src/app/projects/[projectId]/settings/page.test.tsx`
- `src/app/projects/[projectId]/settings/page.tsx`

### src/app/projects/new/
- `src/app/projects/new/page.test.tsx`
- `src/app/projects/new/page.tsx`

### src/app/reports/
- `src/app/reports/page.test.tsx`
- `src/app/reports/page.tsx`

### src/components/
- `src/components/ImportFromJiraButton.test.tsx`
- `src/components/ImportFromJiraButton.tsx`
- `src/components/ImportReview.test.tsx`
- `src/components/ImportReview.tsx`
- `src/components/KanbanBoard.test.tsx`
- `src/components/KanbanBoard.tsx`
- `src/components/ProjectNotFound.test.tsx`
- `src/components/ProjectNotFound.tsx`
- `src/components/ProjectSelector.test.tsx`
- `src/components/ProjectSelector.tsx`
- `src/components/ProjectSettingsLink.test.tsx`
- `src/components/ProjectSettingsLink.tsx`
- `src/components/TopNav.test.tsx`
- `src/components/TopNav.tsx`
- `src/components/WorkUnitCard.test.tsx`
- `src/components/WorkUnitCard.tsx`
- `src/components/WorkUnitDetailModal.test.tsx`
- `src/components/WorkUnitDetailModal.tsx`

### src/components/reports/
- `src/components/reports/TimeSeriesChart.test.tsx`
- `src/components/reports/TimeSeriesChart.tsx`
- `src/components/reports/TrendLineChart.test.tsx`
- `src/components/reports/TrendLineChart.tsx`
- `src/components/reports/WeeklyBarChart.test.tsx`
- `src/components/reports/WeeklyBarChart.tsx`

### src/hooks/
- `src/hooks/useTheme.ts`

### src/lib/
- *(21 files: 21 .ts)*

### src/lib/anthropic/
- `src/lib/anthropic/breakdown.test.ts`
- `src/lib/anthropic/breakdown.ts`
- `src/lib/anthropic/client.ts`
- `src/lib/anthropic/codebaseContext.test.ts`
- `src/lib/anthropic/codebaseContext.ts`
- `src/lib/anthropic/consolidateAcceptanceCriteria.test.ts`
- `src/lib/anthropic/consolidateAcceptanceCriteria.ts`
- `src/lib/anthropic/generateAcceptanceCriteria.test.ts`
- `src/lib/anthropic/generateAcceptanceCriteria.ts`
- `src/lib/anthropic/summarize.test.ts`
- `src/lib/anthropic/summarize.ts`

### src/lib/github/
- `src/lib/github/client.test.ts`
- `src/lib/github/client.ts`
- `src/lib/github/prGatedCompletion.test.ts`
- `src/lib/github/prGatedCompletion.ts`
- `src/lib/github/prMatch.test.ts`
- `src/lib/github/prMatch.ts`

### src/lib/jira/
- `src/lib/jira/adf.test.ts`
- `src/lib/jira/adf.ts`
- `src/lib/jira/client.test.ts`
- `src/lib/jira/client.ts`
- `src/lib/jira/jql.test.ts`
- `src/lib/jira/jql.ts`
- `src/lib/jira/transitions.test.ts`
- `src/lib/jira/transitions.ts`
- `src/lib/jira/writeback.test.ts`
- `src/lib/jira/writeback.ts`

### src/lib/reports/
- `src/lib/reports/completedWork.test.ts`
- `src/lib/reports/completedWork.ts`
- `src/lib/reports/jiraTrail.test.ts`
- `src/lib/reports/jiraTrail.ts`
- `src/lib/reports/snapshot.test.ts`
- `src/lib/reports/snapshot.ts`
- `src/lib/reports/stats.test.ts`
- `src/lib/reports/stats.ts`
- `src/lib/reports/throughput.test.ts`
- `src/lib/reports/throughput.ts`
- `src/lib/reports/trends.test.ts`
- `src/lib/reports/trends.ts`
- `src/lib/reports/types.ts`
- `src/lib/reports/verificationCapacity.test.ts`
- `src/lib/reports/verificationCapacity.ts`

### src/mcp/
- `src/mcp/client.test.ts`
- `src/mcp/client.ts`
- `src/mcp/readLocalImage.test.ts`
- `src/mcp/readLocalImage.ts`
- `src/mcp/server.test.ts`
- `src/mcp/server.ts`
- `src/mcp/tools.test.ts`
- `src/mcp/tools.ts`
