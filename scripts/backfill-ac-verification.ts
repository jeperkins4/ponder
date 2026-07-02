/**
 * One-off backfill for work units imported before AC/Verification became
 * structured fields and before parent-key title prefixes were stripped:
 *   1. Extract embedded "Acceptance Criteria:"/"Verification:" from `description`
 *      into the structured fields (only when both structured fields are null, so
 *      it never clobbers already-structured data), trimming them out of the
 *      description.
 *   2. Strip a redundant leading parent-key prefix from the title
 *      (e.g. "COM-541-5 — Foo" → "Foo"), since the card shows the key as a badge.
 *
 * Idempotent: re-running only changes rows that still need it.
 *
 * Run: npx dotenv -e .env -- npx tsx scripts/backfill-ac-verification.ts
 * (dry run: append `--dry`)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  parseWorkUnitDescription,
  hasEmbeddedAcOrVerification,
  stripParentKeyFromTitle,
} from "../src/lib/workUnitDescription";

const dryRun = process.argv.includes("--dry");
const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

async function main() {
  const workUnits = await prisma.workUnit.findMany({
    select: {
      id: true,
      title: true,
      description: true,
      acceptanceCriteria: true,
      verification: true,
      story: { select: { jiraKey: true } },
    },
  });

  let updated = 0;
  for (const wu of workUnits) {
    const data: {
      title?: string;
      description?: string | null;
      acceptanceCriteria?: string | null;
      verification?: string | null;
    } = {};

    // 1. Strip a redundant parent-key prefix from the title.
    const cleanedTitle = stripParentKeyFromTitle(wu.title, wu.story?.jiraKey);
    if (cleanedTitle !== wu.title) data.title = cleanedTitle;

    // 2. Extract embedded AC/Verification when the structured fields are empty.
    if (
      wu.acceptanceCriteria == null &&
      wu.verification == null &&
      hasEmbeddedAcOrVerification(wu.description)
    ) {
      const parsed = parseWorkUnitDescription(wu.description);
      if (parsed.acceptanceCriteria != null || parsed.verification != null) {
        data.description = parsed.description;
        data.acceptanceCriteria = parsed.acceptanceCriteria;
        data.verification = parsed.verification;
      }
    }

    if (Object.keys(data).length === 0) continue;

    if (dryRun) {
      console.log(`[dry] ${wu.id}: ${Object.keys(data).join(", ")}`);
    } else {
      await prisma.workUnit.update({ where: { id: wu.id }, data });
    }
    updated++;
  }

  console.log(
    `${dryRun ? "[dry] would update" : "Updated"} ${updated} work unit(s) (scanned ${workUnits.length}).`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
