/**
 * JIRA write-back client functions.
 * These are the ONLY functions in this codebase that write to JIRA (everything
 * else is read/import). Reuses the same Basic-auth header construction as
 * `src/lib/jira/client.ts`.
 */

import type { JiraConfig } from "@/lib/jira/client";
import type { JiraTransition } from "@/lib/jira/transitions";
import { textToAdf } from "@/lib/jira/adf";

function basicAuthHeader(config: JiraConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
}

/**
 * Fetches the list of workflow transitions currently available for an issue.
 * GET `${siteUrl}/rest/api/3/issue/${issueKey}/transitions`
 * @throws Error if the request fails
 */
export async function getTransitions(
  issueKey: string,
  config: JiraConfig
): Promise<JiraTransition[]> {
  const url = new URL(config.siteUrl);
  url.pathname = `/rest/api/3/issue/${issueKey}/transitions`;

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`JIRA API error: ${response.status}`);
  }

  const data: { transitions: JiraTransition[] } = await response.json();
  return data.transitions;
}

/**
 * Executes a workflow transition on an issue.
 * POST `${siteUrl}/rest/api/3/issue/${issueKey}/transitions` with body
 * `{ transition: { id: transitionId } }`.
 * @throws Error if the request fails
 */
export async function transitionIssue(
  issueKey: string,
  transitionId: string,
  config: JiraConfig
): Promise<void> {
  const url = new URL(config.siteUrl);
  url.pathname = `/rest/api/3/issue/${issueKey}/transitions`;

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transition: { id: transitionId } }),
  });

  if (!response.ok) {
    throw new Error(`JIRA API error: ${response.status}`);
  }
}

/** A file to upload as a JIRA attachment. */
export type AttachmentFile = {
  buffer: Buffer | ArrayBuffer;
  filename: string;
  mimeType: string;
};

/**
 * Uploads a file as an attachment on an issue.
 * POST `${siteUrl}/rest/api/3/issue/${issueKey}/attachments` with a
 * multipart/form-data body containing a single `file` field. Requires the
 * `X-Atlassian-Token: no-check` header (JIRA rejects attachment uploads
 * without it). The `Content-Type` header is intentionally left unset so
 * `fetch` can generate the multipart boundary itself.
 * @throws Error if the request fails
 */
export async function uploadAttachment(
  issueKey: string,
  file: AttachmentFile,
  config: JiraConfig
): Promise<void> {
  const url = new URL(config.siteUrl);
  url.pathname = `/rest/api/3/issue/${issueKey}/attachments`;

  const bytes: Uint8Array = Buffer.isBuffer(file.buffer)
    ? new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength)
    : new Uint8Array(file.buffer);

  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], file.filename, { type: file.mimeType }));

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`JIRA API error: ${response.status}`);
  }
}

/**
 * Adds a comment to an issue.
 * POST `${siteUrl}/rest/api/3/issue/${issueKey}/comment` with body
 * `{ body: <ADF document> }` (JIRA v3 comment bodies must be ADF, not plain text).
 * @throws Error if the request fails
 */
export async function addComment(
  issueKey: string,
  text: string,
  config: JiraConfig
): Promise<void> {
  const url = new URL(config.siteUrl);
  url.pathname = `/rest/api/3/issue/${issueKey}/comment`;

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: textToAdf(text) }),
  });

  if (!response.ok) {
    throw new Error(`JIRA API error: ${response.status}`);
  }
}
