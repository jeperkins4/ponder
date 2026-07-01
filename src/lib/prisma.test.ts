/**
 * Integration test for Prisma client and database models
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";

describe("Prisma Integration", () => {
  beforeEach(async () => {
    // Clear both tables before each test
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("should create a story with a work unit and read it back", async () => {
    // Create a Story
    const story = await prisma.story.create({
      data: {
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "Example story",
        description: "A test story",
        jiraStatus: "To Do",
        url: "https://example.atlassian.net/browse/TEAM-1",
        lastSyncedAt: new Date(),
      },
    });

    // Create a WorkUnit for that story
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "First work unit",
        description: "A test work unit",
        column: "todo",
        order: 0,
      },
    });

    // Find the story with workUnits
    const foundStory = await prisma.story.findUnique({
      where: { id: story.id },
      include: { workUnits: true },
    });

    // Assert
    expect(foundStory).toBeDefined();
    expect(foundStory!.jiraKey).toBe("TEAM-1");
    expect(foundStory!.workUnits).toHaveLength(1);
    expect(foundStory!.workUnits[0].title).toBe("First work unit");
  });
});
