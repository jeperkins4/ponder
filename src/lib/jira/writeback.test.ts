/**
 * Unit tests for JIRA write-back client functions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTransitions, transitionIssue, addComment, uploadAttachment, getIssueStatus } from "./writeback";
import type { JiraConfig } from "./client";

describe("JIRA write-back client", () => {
  const mockConfig: JiraConfig = {
    siteUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "test-token-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTransitions", () => {
    it("GETs the transitions endpoint and returns the transitions array", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          transitions: [
            { id: "1", name: "Start", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await getTransitions("TEAM-1", mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.atlassian.net/rest/api/3/issue/TEAM-1/transitions");
      expect(options.method).toBe("GET");
      const authHeader = (options.headers as Record<string, string>).Authorization;
      expect(authHeader).toMatch(/^Basic /);
    });

    it("throws on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401 })
      );

      await expect(getTransitions("TEAM-1", mockConfig)).rejects.toThrow(
        "JIRA API error: 401"
      );
    });
  });

  describe("transitionIssue", () => {
    it("POSTs the transition id to the transitions endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      vi.stubGlobal("fetch", mockFetch);

      await transitionIssue("TEAM-1", "21", mockConfig);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.atlassian.net/rest/api/3/issue/TEAM-1/transitions");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(options.body)).toEqual({ transition: { id: "21" } });
    });

    it("throws on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 400 })
      );

      await expect(
        transitionIssue("TEAM-1", "21", mockConfig)
      ).rejects.toThrow("JIRA API error: 400");
    });
  });

  describe("addComment", () => {
    it("POSTs an ADF-wrapped comment body to the comment endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
      vi.stubGlobal("fetch", mockFetch);

      await addComment("TEAM-1", "All work complete.", mockConfig);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.atlassian.net/rest/api/3/issue/TEAM-1/comment");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(options.body);
      expect(body.body.type).toBe("doc");
      expect(body.body.content[0].content[0].text).toBe("All work complete.");
    });

    it("throws on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500 })
      );

      await expect(
        addComment("TEAM-1", "text", mockConfig)
      ).rejects.toThrow("JIRA API error: 500");
    });
  });

  describe("getIssueStatus", () => {
    it("GETs the issue with fields=status and returns its status name", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ fields: { status: { name: "QA" } } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await getIssueStatus("TEAM-1", mockConfig);

      expect(result).toEqual({ name: "QA" });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://example.atlassian.net/rest/api/3/issue/TEAM-1?fields=status"
      );
      expect(options.method).toBe("GET");
      const authHeader = (options.headers as Record<string, string>).Authorization;
      expect(authHeader).toMatch(/^Basic /);
    });

    it("throws on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 404 })
      );

      await expect(getIssueStatus("TEAM-1", mockConfig)).rejects.toThrow(
        "JIRA API error: 404"
      );
    });
  });

  describe("uploadAttachment", () => {
    const file = {
      buffer: Buffer.from("fake image bytes"),
      filename: "screenshot.png",
      mimeType: "image/png",
    };

    it("POSTs a multipart form with the file to the attachments endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      await uploadAttachment("TEAM-1", file, mockConfig);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://example.atlassian.net/rest/api/3/issue/TEAM-1/attachments"
      );
      expect(options.method).toBe("POST");

      const headers = options.headers as Record<string, string>;
      expect(headers["X-Atlassian-Token"]).toBe("no-check");
      expect(headers.Authorization).toMatch(/^Basic /);
      expect(headers["Content-Type"]).toBeUndefined();

      expect(options.body).toBeInstanceOf(FormData);
      const uploaded = (options.body as FormData).get("file") as File;
      expect(uploaded).toBeTruthy();
      expect(uploaded.name).toBe("screenshot.png");
      expect(uploaded.type).toBe("image/png");
    });

    it("accepts an ArrayBuffer as well as a Buffer", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;
      await uploadAttachment(
        "TEAM-1",
        { buffer: arrayBuffer, filename: "a.png", mimeType: "image/png" },
        mockConfig
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 413 })
      );

      await expect(uploadAttachment("TEAM-1", file, mockConfig)).rejects.toThrow(
        "JIRA API error: 413"
      );
    });
  });
});
