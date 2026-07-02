/**
 * One-off backfill: work units imported before Acceptance Criteria / Verification
 * became structured fields still carry that text inside `description`, with the
 * structured fields empty — so the detail modal shows it twice. This extracts the
 * embedded sections into `acceptanceCriteria`/`verification` and trims them out of
 * `description`.
 *
 * Only touches rows whose description embeds the headings AND whose structured
 * fields are both still null (never clobbers already-structured data).
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
} from "../src/lib/workUnitDescription";

const dryRun = process.argv.includes("--dry");
const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

async function main() {
  const candidates = await prisma.workUnit.findMany({
    where: { acceptanceCriteria: null, verification: null },
    select: { id: true, description: true },
  });

  let updated = 0;
  for (const wu of candidates) {
    if (!hasEmbeddedAcOrVerification(wu.description)) continue;
    const parsed = parseWorkUnitDescription(wu.description);
    // Nothing to extract (shouldn't happen given the guard, but be safe).
    if (parsed.acceptanceCriteria == null && parsed.verification == null) continue;

    if (dryRun) {
      console.log(`[dry] ${wu.id}: AC=${!!parsed.acceptanceCriteria} VER=${!!parsed.verification}`);
    } else {
      await prisma.workUnit.update({
        where: { id: wu.id },
        data: {
          description: parsed.description,
          acceptanceCriteria: parsed.acceptanceCriteria,
          verification: parsed.verification,
        },
      });
    }
    updated++;
  }

  console.log(
    `${dryRun ? "[dry] would update" : "Updated"} ${updated} work unit(s) (scanned ${candidates.length}).`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
