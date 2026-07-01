/**
 * Claude API integration for JIRA story breakdown
 * Uses Claude to split stories into work units
 */

/**
 * Represents a single work unit from a broken-down story
 */
export interface WorkUnit {
  title: string;
  description: string;
}

/**
 * Result of breaking down a story into work units
 */
export interface BreakdownResult {
  workUnits: WorkUnit[];
}

/**
 * Claude API message response structure
 */
interface ClaudeMessageResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

/**
 * Breaks down a JIRA story into work units using Claude API
 * @param summary - Story summary/title
 * @param description - Story description
 * @param anthropicApiKey - Anthropic API key for authentication
 * @returns Object containing array of work units
 * @throws Error if API request fails or JSON parsing fails
 */
export async function breakdownStory(
  summary: string,
  description: string,
  anthropicApiKey: string
): Promise<BreakdownResult> {
  const url = "https://api.anthropic.com/v1/messages";

  const storyText = description
    ? `${summary}\n\n${description}`
    : summary;

  const prompt = `Break down this JIRA story into 3-5 work units with titles and brief descriptions. Return a JSON array with { title, description } for each unit.

Story:
${storyText}

Return ONLY valid JSON array (no markdown formatting, no code blocks).`;

  const requestBody = {
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anthropicApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(
      `Claude API error: ${response.status} ${response.statusText}`
    );
  }

  const data: ClaudeMessageResponse = await response.json();

  // Extract text from first content block
  if (!data.content || data.content.length === 0 || data.content[0].type !== "text") {
    throw new Error("Invalid Claude API response: no text content");
  }

  const responseText = data.content[0].text;

  // Parse JSON response
  let workUnits: WorkUnit[];
  try {
    workUnits = JSON.parse(responseText);

    // Validate that we got an array
    if (!Array.isArray(workUnits)) {
      throw new Error("Claude API response is not an array");
    }

    // Validate structure of each work unit
    for (const unit of workUnits) {
      if (
        typeof unit !== "object" ||
        typeof unit.title !== "string" ||
        typeof unit.description !== "string"
      ) {
        throw new Error(
          "Invalid work unit structure: must have title and description as strings"
        );
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse Claude response as JSON: ${error.message}`);
    }
    throw error;
  }

  return { workUnits };
}
