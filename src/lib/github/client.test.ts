/**
 * Unit tests for fetchRecentPrs with a stubbed fetch — no network.
 */

import { describe, it, expect, vi } from "vitest";
import { fetchRecentPrs } from "./client";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchRecentPrs", () => {
  it("requests the repo's PRs with auth and maps the response shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse([
        {
          number: 42,
          title: "COM-540: Team page",
          state: "closed",
          merged_at: "2026-07-05T12:00:00Z",
          html_url: "https://github.com/sphero/team-alliance/pull/42",
          head: { ref: "feature/COM-540-team-page" },
        },
        {
          number: 43,
          title: "WIP",
          state: "open",
          merged_at: null,
          html_url: "https://github.com/sphero/team-alliance/pull/43",
          head: { ref: "wip-branch" },
        },
      ])
    );

    const result = await fetchRecentPrs("sphero/team-alliance", "tok", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/sphero/team-alliance/pulls?state=all&sort=updated&direction=desc&per_page=100",
      {
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/vnd.github+json",
        },
      }
    );
    expect(result).toEqual([
      {
        number: 42,
        title: "COM-540: Team page",
        headRef: "feature/COM-540-team-page",
        state: "closed",
        merged: true,
        url: "https://github.com/sphero/team-alliance/pull/42",
      },
      {
        number: 43,
        title: "WIP",
        headRef: "wip-branch",
        state: "open",
        merged: false,
        url: "https://github.com/sphero/team-alliance/pull/43",
      },
    ]);
  });

  it("returns a warning (not a throw) on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found" })
    );

    const result = await fetchRecentPrs("sphero/missing", "tok", fetchImpl);

    expect(result).toEqual({ warning: "sphero/missing: 404 Not Found" });
  });

  it("returns a warning (not a throw) on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchRecentPrs("sphero/team-alliance", "tok", fetchImpl);

    expect(result).toEqual({ warning: "sphero/team-alliance: ECONNREFUSED" });
  });
});
