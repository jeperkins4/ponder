/**
 * ADF (Atlassian Document Format) to plain text conversion
 * Extracts text content from JIRA's document format
 */

/**
 * Represents a node in the Atlassian Document Format tree
 */
export type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};

/**
 * Root ADF document node. JIRA requires `version` as a top-level sibling of
 * `type`/`content` (not nested inside `attrs`).
 */
export type AdfDocument = {
  type: "doc";
  version: 1;
  content: AdfNode[];
};

/**
 * Converts an ADF (Atlassian Document Format) document to plain text
 * Extracts text from all text nodes and separates paragraphs/headings with newlines
 * @param doc - ADF document node or null/undefined
 * @returns Plain text representation of the document
 */
export function adfToPlainText(doc: AdfNode | null | undefined): string {
  if (!doc) return "";

  const buffer: string[] = [];

  /**
   * Recursively walks the ADF tree, extracting text
   */
  function walk(node: AdfNode) {
    // Extract text from text nodes
    if (node.type === "text" && node.text) {
      buffer.push(node.text);
    }

    // Recursively process child nodes
    if (node.content) {
      for (const child of node.content) {
        walk(child);
      }
    }

    // Add newline after paragraphs and headings
    if (node.type === "paragraph" || node.type === "heading") {
      buffer.push("\n");
    }
  }

  walk(doc);
  return buffer.join("").trim();
}

/**
 * Converts plain text into a minimal valid Atlassian Document Format (ADF)
 * document: a single paragraph containing a single text node. This is the
 * reverse of `adfToPlainText` for the simple case of posting a comment body
 * built from plain-text content (e.g. a Claude-generated summary).
 * @param text - Plain text to wrap in ADF
 * @returns A minimal ADF document
 */
export function textToAdf(text: string): AdfDocument {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}
