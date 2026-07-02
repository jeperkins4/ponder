/**
 * Shared prompt fragments for grounding Claude output in a slice of an
 * Understand-Anything knowledge graph. Used by both the story-breakdown and
 * single-work-unit AC generators so the anti-hallucination guardrail wording
 * lives in exactly one place.
 */

const CONTEXT_HEADER =
  "CODEBASE CONTEXT (from the Understand-Anything knowledge graph). " +
  "These are real files, layers, and tests from the target codebase:";

/**
 * The system-prompt clause added whenever codebase context is supplied.
 * Steers Claude to cite real paths/tests AND forbids fabricating any that are
 * not present in the provided slice (grounded-but-wrong is worse than generic).
 */
export const CODEBASE_GROUNDING_INSTRUCTION =
  "A CODEBASE CONTEXT section is included with the work. Ground the acceptance " +
  "criteria and verification in the ACTUAL files, architectural layers, and " +
  "tests it lists — reference real file paths and test commands where relevant. " +
  "Do NOT invent files, modules, functions, or tests that are not present in the " +
  "provided context; when unsure, stay general rather than fabricate a path.";

/** Wraps a raw context string in the labelled block appended to the user message. */
export function buildContextUserBlock(codebaseContext: string): string {
  return `${CONTEXT_HEADER}\n${codebaseContext}`;
}
