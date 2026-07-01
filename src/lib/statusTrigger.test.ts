/**
 * Unit tests for status trigger logic
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import { checkAndUpdateStoryStatus } from "./statusTrigger";

describe("checkAndUpdateStoryStatus", () => {
  beforeEach(async () => {
    // Clear both tables before each test
    await prisma.workUnit.deleteMany({});
    await prisma.story.deleteMany({});
  });

  it("should return false when not all work units are done", async () => {
    // Create a story
    const story = await prisma.story.create({
      data: {
        jiraKey: "TEAM-1",
        jiraId: "10000",
        projectKey: "TEAM",
        summary: "Test story",
        description: "A test story",
        jiraStatus: "In Progress",
        url: "https://example.atlassian.net/browse/TEAM-1",
        lastSyncedAt: new Date(),
      },
    });

    // Create work units with mixed statuses
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 1",
        description: "First task",
        column: "done",
        order: 0,
      },
    });

    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 2",
        description: "Second task",
        column: "in_progress",
        order: 1,
      },
    });

    // Check status (should return false since not all are done)
    const updated = await checkAndUpdateStoryStatus(story.id, prisma);
    expect(updated).toBe(false);

    // Verify story status was not changed
    const updatedStory = await prisma.story.findUnique({
      where: { id: story.id },
    });
    expect(updatedStory?.jiraStatus).toBe("In Progress");
  });

  it("should return true and update status when all work units are done", async () => {
    // Create a story
    const story = await prisma.story.create({
      data: {
        jiraKey: "TEAM-2",
        jiraId: "10001",
        projectKey: "TEAM",
        summary: "Test story for completion",
        description: "A test story",
        jiraStatus: "In Progress",
        url: "https://example.atlassian.net/browse/TEAM-2",
        lastSyncedAt: new Date(),
      },
    });

    // Create work units - all done
    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 1",
        description: "First task",
        column: "done",
        order: 0,
      },
    });

    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 2",
        description: "Second task",
        column: "done",
        order: 1,
      },
    });

    await prisma.workUnit.create({
      data: {
        storyId: story.id,
        title: "Task 3",
        description: "Third task",
        column: "done",
        order: 2,
      },
    });

    // Check status (should return true and update)
    const updated = await checkAndUpdateStoryStatus(story.id, prisma);
    expect(updated).toBe(true);

    // Verify story status was changed to "Done"
    const updatedStory = await prisma.story.findUnique({
      where: { id: story.id },
    });
    expect(updatedStory?.jiraStatus).toBe("Done");
  });

  it("should return false when story has no work units", async () => {
    // Create a story with no work units
    const story = await prisma.story.create({
      data: {
        jiraKey: "TEAM-3",
        jiraId: "10002",
        projectKey: "TEAM",
        summary: "Test story with no tasks",
        description: "A test story",
        jiraStatus: "In Progress",
        url: "https://example.atlassian.net/browse/TEAM-3",
        lastSyncedAt: new Date(),
      },
    });

    // Check status (should return false since there are no work units)
    const updated = await checkAndUpdateStoryStatus(story.id, prisma);
    expect(updated).toBe(false);

    // Verify story status was not changed
    const updatedStory = await prisma.story.findUnique({
      where: { id: story.id },
    });
    expect(updatedStory?.jiraStatus).toBe("In Progress");
  });

  it("should throw error if story does not exist", async () => {
    // Try to check status for a non-existent story
    await expect(
      checkAndUpdateStoryStatus("non-existent-id", prisma)
    ).rejects.toThrow("Story not found: non-existent-id");
  });

  afterAll(async () => {
    // Properly close database connections and adapter resources
    await prisma.$disconnect();
  });
});
