import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const projectId = process.argv[2];
if (!projectId) throw new Error("usage: node clear-project-stories.mjs <projectId>");

const stories = await prisma.story.findMany({
  where: { projectId },
  select: { id: true },
});
const storyIds = stories.map((s) => s.id);

const wu = await prisma.workUnit.deleteMany({
  where: { OR: [{ projectId }, { storyId: { in: storyIds } }] },
});
const st = await prisma.story.deleteMany({ where: { projectId } });

console.log(`Cleared project ${projectId}: ${st.count} stories, ${wu.count} work units`);
await prisma.$disconnect();
