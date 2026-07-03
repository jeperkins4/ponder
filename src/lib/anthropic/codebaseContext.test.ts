import { describe, it, expect } from "vitest";
import {
  buildContextUserBlock,
  CODEBASE_GROUNDING_INSTRUCTION,
} from "@/lib/anthropic/codebaseContext";

describe("codebaseContext fragments", () => {
  it("wraps the context in a labelled block", () => {
    const block = buildContextUserBlock('{"domain":"Projects"}');
    expect(block).toContain("CODEBASE CONTEXT");
    expect(block).toContain('{"domain":"Projects"}');
  });

  it("grounding instruction forbids inventing files", () => {
    expect(CODEBASE_GROUNDING_INSTRUCTION.toLowerCase()).toContain("do not invent");
  });
});
