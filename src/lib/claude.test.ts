/**
 * Unit tests for Claude API integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { breakdownStory, type BreakdownResult } from "./claude";

describe("breakdownStory", () => {
  const mockApiKey = "sk-ant-test-key";
  const mockSummary = "Implement user authentication";
  const mockDescription = "Add JWT-based authentication to the API";

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  it("breaks down story with valid response", async () => {
    // Mock successful response with 3 work units
    const mockResponse: BreakdownResult = {
      workUnits: [
        { title: "Create JWT token generation", description: "Implement JWT token generation logic" },
        { title: "Add token validation middleware", description: "Add middleware to validate JWT tokens" },
        { title: "Create login endpoint", description: "Implement login endpoint that returns JWT token" },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: JSON.stringify(mockResponse.workUnits),
            },
          ],
        }),
      })
    );

    const result = await breakdownStory(mockSummary, mockDescription, mockApiKey);

    expect(result.workUnits).toHaveLength(3);
    expect(result.workUnits[0].title).toBe("Create JWT token generation");
    expect(result.workUnits[1].title).toBe("Add token validation middleware");
    expect(result.workUnits[2].title).toBe("Create login endpoint");
  });

  it("handles API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    await expect(breakdownStory(mockSummary, mockDescription, mockApiKey)).rejects.toThrow(
      "Claude API error: 500 Internal Server Error"
    );
  });

  it("makes correct API request", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify([]) }],
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    await breakdownStory(mockSummary, mockDescription, mockApiKey);

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.any(Object)
    );

    // Verify fetch was called with correct method and headers
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[1].headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(callArgs[1].headers["content-type"]).toBe("application/json");

    // Verify request body structure
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe("claude-3-5-sonnet");
    expect(body.max_tokens).toBe(1024);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(typeof body.messages[0].content).toBe("string");
    expect(body.messages[0].content).toContain("Break down this JIRA story");
  });

  it("parses JSON from Claude response", async () => {
    const workUnitsJson = JSON.stringify([
      { title: "Task 1", description: "Do task 1" },
      { title: "Task 2", description: "Do task 2" },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: workUnitsJson,
            },
          ],
        }),
      })
    );

    const result = await breakdownStory(mockSummary, mockDescription, mockApiKey);

    expect(result.workUnits).toHaveLength(2);
    expect(result.workUnits[0]).toEqual({ title: "Task 1", description: "Do task 1" });
    expect(result.workUnits[1]).toEqual({ title: "Task 2", description: "Do task 2" });
  });

  it("throws error on invalid JSON from Claude", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: "not valid json {{{",
            },
          ],
        }),
      })
    );

    await expect(breakdownStory(mockSummary, mockDescription, mockApiKey)).rejects.toThrow(
      "Failed to parse Claude response as JSON"
    );
  });

  it("throws error when response is not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: JSON.stringify({ title: "Task", description: "Do task" }),
            },
          ],
        }),
      })
    );

    await expect(breakdownStory(mockSummary, mockDescription, mockApiKey)).rejects.toThrow(
      "Claude API response is not an array"
    );
  });

  it("throws error when work units have invalid structure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          content: [
            {
              type: "text",
              text: JSON.stringify([{ title: "Task 1" }]), // Missing description
            },
          ],
        }),
      })
    );

    await expect(breakdownStory(mockSummary, mockDescription, mockApiKey)).rejects.toThrow(
      "Invalid work unit structure"
    );
  });

  it("throws error when response has no text content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          content: [],
        }),
      })
    );

    await expect(breakdownStory(mockSummary, mockDescription, mockApiKey)).rejects.toThrow(
      "Invalid Claude API response: no text content"
    );
  });

  it("combines summary and description in prompt", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify([]) }],
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    await breakdownStory(mockSummary, mockDescription, mockApiKey);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const prompt = body.messages[0].content;

    expect(prompt).toContain(mockSummary);
    expect(prompt).toContain(mockDescription);
  });

  it("handles story with only summary (no description)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify([]) }],
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    await breakdownStory(mockSummary, "", mockApiKey);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const prompt = body.messages[0].content;

    expect(prompt).toContain(mockSummary);
  });
});
