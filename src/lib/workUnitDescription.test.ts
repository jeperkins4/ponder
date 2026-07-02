import { describe, it, expect } from "vitest";
import {
  parseWorkUnitDescription,
  hasEmbeddedAcOrVerification,
  stripParentKeyFromTitle,
} from "@/lib/workUnitDescription";

describe("parseWorkUnitDescription", () => {
  it("returns nulls for empty/blank input", () => {
    expect(parseWorkUnitDescription(null)).toEqual({
      description: null,
      acceptanceCriteria: null,
      verification: null,
    });
    expect(parseWorkUnitDescription("   ")).toEqual({
      description: null,
      acceptanceCriteria: null,
      verification: null,
    });
  });

  it("leaves a plain description untouched (no headings)", () => {
    const raw = "Just a normal description with no sections.";
    expect(parseWorkUnitDescription(raw)).toEqual({
      description: raw,
      acceptanceCriteria: null,
      verification: null,
    });
  });

  it("splits lead / acceptance criteria / verification", () => {
    const raw = [
      "Add a clock icon for waitlisted registrations",
      "",
      "Acceptance Criteria:",
      "When a coordinator has a waitlist, a clock icon appears.",
      "",
      "Verification:",
      "Manually add a team to a waitlist and confirm the icon.",
    ].join("\n");

    const parsed = parseWorkUnitDescription(raw);
    expect(parsed.description).toBe(
      "Add a clock icon for waitlisted registrations"
    );
    expect(parsed.acceptanceCriteria).toBe(
      "When a coordinator has a waitlist, a clock icon appears."
    );
    expect(parsed.verification).toBe(
      "Manually add a team to a waitlist and confirm the icon."
    );
  });

  it("is case-insensitive and handles inline headings", () => {
    const raw =
      "Lead text. acceptance criteria: must work. VERIFICATION: run the test.";
    const parsed = parseWorkUnitDescription(raw);
    expect(parsed.description).toBe("Lead text.");
    expect(parsed.acceptanceCriteria).toBe("must work.");
    expect(parsed.verification).toBe("run the test.");
  });

  it("handles only acceptance criteria (no verification)", () => {
    const raw = "Summary\n\nAcceptance Criteria:\nIt does the thing.";
    const parsed = parseWorkUnitDescription(raw);
    expect(parsed.description).toBe("Summary");
    expect(parsed.acceptanceCriteria).toBe("It does the thing.");
    expect(parsed.verification).toBeNull();
  });

  it("nulls the description when there is no lead text", () => {
    const raw = "Acceptance Criteria:\nfoo\n\nVerification:\nbar";
    const parsed = parseWorkUnitDescription(raw);
    expect(parsed.description).toBeNull();
    expect(parsed.acceptanceCriteria).toBe("foo");
    expect(parsed.verification).toBe("bar");
  });

  it("handles verification appearing before acceptance criteria", () => {
    const raw = "Lead\n\nVerification:\nver text\n\nAcceptance Criteria:\nac text";
    const parsed = parseWorkUnitDescription(raw);
    expect(parsed.description).toBe("Lead");
    expect(parsed.verification).toBe("ver text");
    expect(parsed.acceptanceCriteria).toBe("ac text");
  });
});

describe("stripParentKeyFromTitle", () => {
  it("strips a KEY-N — prefix that matches the parent", () => {
    expect(
      stripParentKeyFromTitle("COM-541-5 — Implement removal action", "COM-541")
    ).toBe("Implement removal action");
  });

  it("strips a bare KEY prefix with a colon or hyphen separator", () => {
    expect(stripParentKeyFromTitle("COM-541: Do the thing", "COM-541")).toBe(
      "Do the thing"
    );
    expect(stripParentKeyFromTitle("COM-541 - Do the thing", "COM-541")).toBe(
      "Do the thing"
    );
  });

  it("leaves titles without the parent prefix untouched", () => {
    expect(stripParentKeyFromTitle("Implement removal action", "COM-541")).toBe(
      "Implement removal action"
    );
    // A different key is not stripped.
    expect(stripParentKeyFromTitle("TEAM-9 — Something", "COM-541")).toBe(
      "TEAM-9 — Something"
    );
  });

  it("does not over-strip a hyphenated word (no trailing space separator)", () => {
    expect(stripParentKeyFromTitle("COM-541-5-ish thing", "COM-541")).toBe(
      "COM-541-5-ish thing"
    );
  });

  it("is a no-op without a parent key", () => {
    expect(stripParentKeyFromTitle("COM-541-5 — X", null)).toBe("COM-541-5 — X");
  });
});

describe("hasEmbeddedAcOrVerification", () => {
  it("detects embedded sections", () => {
    expect(hasEmbeddedAcOrVerification("x\nAcceptance Criteria:\ny")).toBe(true);
    expect(hasEmbeddedAcOrVerification("x\nVerification:\ny")).toBe(true);
    expect(hasEmbeddedAcOrVerification("plain text")).toBe(false);
    expect(hasEmbeddedAcOrVerification(null)).toBe(false);
  });
});
