/**
 * Pure unit tests for findPrForKey. Word-boundary, case-insensitive match
 * against branch name (headRef) or title; only open-or-merged PRs count.
 */

import { describe, it, expect } from "vitest";
import { findPrForKey } from "./prMatch";
import type { PrSummary } from "./client";

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    number: 1,
    title: "Unrelated title",
    headRef: "unrelated-branch",
    state: "open",
    merged: false,
    url: "https://github.com/o/r/pull/1",
    ...overrides,
  };
}

describe("findPrForKey", () => {
  it("matches the key in a branch name", () => {
    const match = pr({ headRef: "feature/COM-540-team-page" });
    expect(findPrForKey("COM-540", [match])).toBe(match);
  });

  it("matches the key in a title", () => {
    const match = pr({ title: "COM-540: Team page changes" });
    expect(findPrForKey("COM-540", [match])).toBe(match);
  });

  it("matches case-insensitively", () => {
    const match = pr({ headRef: "feature/com-540-team-page" });
    expect(findPrForKey("COM-540", [match])).toBe(match);
  });

  it("matches when the key is bracketed or at string edges", () => {
    expect(findPrForKey("COM-540", [pr({ title: "[COM-540] fix" })])).not.toBeNull();
    expect(findPrForKey("COM-540", [pr({ headRef: "COM-540" })])).not.toBeNull();
    expect(findPrForKey("COM-540", [pr({ title: "fix for COM-540" })])).not.toBeNull();
  });

  it("does not let a shorter key match a longer one (COM-54 vs COM-540)", () => {
    expect(findPrForKey("COM-54", [pr({ headRef: "feature/COM-540-x" })])).toBeNull();
  });

  it("does not match a longer key against a superstring (COM-540 vs COM-5401)", () => {
    expect(findPrForKey("COM-540", [pr({ title: "COM-5401 something" })])).toBeNull();
  });

  it("ignores closed-unmerged PRs but accepts merged ones", () => {
    const closed = pr({ headRef: "COM-540", state: "closed", merged: false });
    expect(findPrForKey("COM-540", [closed])).toBeNull();

    const merged = pr({ headRef: "COM-540", state: "closed", merged: true });
    expect(findPrForKey("COM-540", [merged])).toBe(merged);
  });

  it("returns the first match in list order", () => {
    const first = pr({ number: 10, title: "COM-540 first" });
    const second = pr({ number: 11, headRef: "COM-540-second" });
    expect(findPrForKey("COM-540", [first, second])).toBe(first);
  });

  it("returns null when nothing matches", () => {
    expect(findPrForKey("COM-540", [pr({})])).toBeNull();
    expect(findPrForKey("COM-540", [])).toBeNull();
  });
});
