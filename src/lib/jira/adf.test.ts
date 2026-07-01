/**
 * Unit tests for ADF (Atlassian Document Format) conversion
 */

import { describe, it, expect } from "vitest";
import { adfToPlainText, textToAdf } from "./adf";

describe("ADF to Plain Text Converter", () => {
  it("should return empty string for null input", () => {
    const result = adfToPlainText(null);
    expect(result).toBe("");
  });

  it("should return empty string for undefined input", () => {
    const result = adfToPlainText(undefined);
    expect(result).toBe("");
  });

  it("should extract text from a simple paragraph", () => {
    const adf = {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Hello world",
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("Hello world");
  });

  it("should extract text from multiple paragraphs", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "First paragraph",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Second paragraph",
            },
          ],
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("First paragraph\nSecond paragraph");
  });

  it("should extract text from headings", () => {
    const adf = {
      type: "heading",
      attrs: { level: 1 },
      content: [
        {
          type: "text",
          text: "Title",
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("Title");
  });

  it("should handle nested content", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "This is ",
            },
            {
              type: "text",
              text: "nested text",
            },
          ],
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("This is nested text");
  });

  it("should handle complex mixed content", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [
            {
              type: "text",
              text: "Main Title",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Description",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "More details",
            },
          ],
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("Main Title\nDescription\nMore details");
  });

  it("should skip nodes without text", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Visible",
            },
            {
              type: "hardbreak",
            },
            {
              type: "text",
              text: "Also visible",
            },
          ],
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("VisibleAlso visible");
  });

  it("should trim leading and trailing whitespace", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Text",
            },
          ],
        },
      ],
    };
    const result = adfToPlainText(adf);
    expect(result).toBe("Text");
  });
});

describe("textToAdf", () => {
  it("wraps plain text in a minimal valid ADF document", () => {
    const result = textToAdf("Hello world");
    expect(result).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    });
  });

  it("round-trips through adfToPlainText", () => {
    const text = "Some summary text";
    expect(adfToPlainText(textToAdf(text))).toBe(text);
  });
});
