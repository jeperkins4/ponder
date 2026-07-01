// Demo seed: two projects (one JIRA-linked, one standalone) with stories and
// work units spread across the three columns. Run: node scripts/seed-demo.mjs
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  // Clean slate for the demo (dev DB only).
  await prisma.workUnit.deleteMany({});
  await prisma.story.deleteMany({});
  await prisma.project.deleteMany({});

  // --- Project A: JIRA-linked ---
  const team = await prisma.project.create({
    data: { name: "Team Alliance", type: "JIRA", jiraProjectKey: "TEAM" },
  });

  // --- Project B: Standalone ---
  const personal = await prisma.project.create({
    data: { name: "Personal Tasks", type: "STANDALONE" },
  });

  const now = new Date();

  // Helper to create a story with work units.
  let storyN = 0;
  async function makeStory(project, summary, description, status, units) {
    storyN += 1;
    const key = `${project.jiraProjectKey ?? "LOCAL"}-${storyN}`;
    const story = await prisma.story.create({
      data: {
        jiraKey: key,
        jiraId: `1000${storyN}`,
        projectKey: project.jiraProjectKey ?? "LOCAL",
        projectId: project.id,
        summary,
        description,
        jiraStatus: status,
        url: `https://example.atlassian.net/browse/${key}`,
        lastSyncedAt: now,
      },
    });
    let order = 0;
    for (const u of units) {
      await prisma.workUnit.create({
        data: {
          storyId: story.id,
          projectId: project.id,
          title: u.title,
          description: u.description ?? null,
          column: u.column,
          order: order++,
          completedAt: u.column === "done" ? now : null,
        },
      });
    }
    return story;
  }

  // JIRA project stories
  await makeStory(
    team,
    "Checkout flow redesign",
    "Rework the multi-step checkout for clarity.",
    "In Progress",
    [
      { title: "Audit current funnel", column: "done" },
      { title: "Wireframe new steps", column: "in_progress" },
      { title: "Build address form", column: "todo", description: "With validation + autofill." },
      { title: "Payment integration", column: "todo" },
    ]
  );
  await makeStory(
    team,
    "Fix mobile nav overlap bug",
    "Header nav overlaps content on small screens.",
    "To Do",
    [
      { title: "Reproduce on iPhone SE", column: "in_progress" },
      { title: "Patch z-index + safe-area", column: "todo" },
    ]
  );
  await makeStory(
    team,
    "Add CSV export to reports",
    "Let users export report tables as CSV.",
    "Done",
    [
      { title: "Serialize table to CSV", column: "done" },
      { title: "Wire export button", column: "done" },
    ]
  );

  // Standalone project stories
  await makeStory(
    personal,
    "Plan Q3 roadmap",
    "Break the quarter into shippable milestones.",
    "In Progress",
    [
      { title: "Collect stakeholder input", column: "done" },
      { title: "Draft milestone list", column: "in_progress" },
      { title: "Size each milestone", column: "todo" },
    ]
  );

  const counts = {
    projects: await prisma.project.count(),
    stories: await prisma.story.count(),
    workUnits: await prisma.workUnit.count(),
  };
  console.log("Seeded:", counts);
  console.log("JIRA project id:", team.id);
  console.log("Standalone project id:", personal.id);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
