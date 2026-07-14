/**
 * PonderClient — a thin HTTP client over Ponder's existing REST API.
 *
 * Every method maps to an existing Ponder endpoint so that behavior (e.g.
 * moving a card triggers the JIRA status write-back) is reused with zero
 * duplication. This client performs no business logic of its own.
 */

import type { AttachmentDTO, Column, ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";
import type { ReportsPayload } from "@/lib/reports/types";

export interface EpicImportPreviewStory {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  targetColumn: Column;
  alreadyImported: boolean;
}

export interface EpicImportProcessItem {
  jiraKey: string;
  jiraId: string;
  summary: string;
  description: string | null;
  jiraStatus: string;
  jiraStatusCategory?: "new" | "indeterminate" | "done";
  breakDown: boolean;
}

export class PonderClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl?: string, fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl ?? process.env.PONDER_BASE_URL ?? "http://localhost:3000";
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async getProjects(): Promise<ProjectWithStats[]> {
    return this.request<ProjectWithStats[]>("GET", "/api/projects");
  }

  async getStories(projectId: string): Promise<StoryDTO[]> {
    return this.request<StoryDTO[]>(
      "GET",
      `/api/stories?projectId=${encodeURIComponent(projectId)}`
    );
  }

  async getEpics(projectId: string): Promise<{ key: string; name: string }[]> {
    const result = await this.request<{
      epics: { key: string; name: string }[];
      message?: string;
    }>("GET", `/api/projects/${encodeURIComponent(projectId)}/jira/epics`);
    return result.epics;
  }

  async previewEpicImport(
    projectId: string,
    epicKey: string
  ): Promise<{ stories: EpicImportPreviewStory[]; message?: string }> {
    return this.request<{ stories: EpicImportPreviewStory[]; message?: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/import/preview`,
      { epicKey }
    );
  }

  async processEpicImport(
    projectId: string,
    items: EpicImportProcessItem[],
    epicKey: string,
    epicName?: string
  ): Promise<{ storiesProcessed: number; storiesSkipped: number; workUnitsCreated: number }> {
    return this.request<{
      storiesProcessed: number;
      storiesSkipped: number;
      workUnitsCreated: number;
    }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/import/process`,
      epicName !== undefined ? { items, epicKey, epicName } : { items, epicKey }
    );
  }

  async getReports(
    args: { projectId?: string; from?: string; to?: string } = {}
  ): Promise<ReportsPayload> {
    const params = new URLSearchParams();
    if (args.projectId) params.set("projectId", args.projectId);
    if (args.from) params.set("from", args.from);
    if (args.to) params.set("to", args.to);
    const query = params.toString();
    return this.request<ReportsPayload>(
      "GET",
      `/api/reports${query ? `?${query}` : ""}`
    );
  }

  async moveWorkUnit(
    id: string,
    column: Column,
    order = 0
  ): Promise<WorkUnitDTO> {
    return this.request<WorkUnitDTO>(
      "POST",
      `/api/work-units/${encodeURIComponent(id)}/move`,
      { column, order }
    );
  }

  async updateWorkUnit(
    id: string,
    patch: { title?: string; description?: string }
  ): Promise<WorkUnitDTO> {
    return this.request<WorkUnitDTO>(
      "PATCH",
      `/api/work-units/${encodeURIComponent(id)}`,
      patch
    );
  }

  async regenerateAcceptance(
    id: string,
    codebaseContext?: string
  ): Promise<{ acceptanceCriteria: string; verification: string }> {
    return this.request<{ acceptanceCriteria: string; verification: string }>(
      "POST",
      `/api/work-units/${encodeURIComponent(id)}/generate-acceptance-criteria`,
      codebaseContext !== undefined ? { codebaseContext } : {}
    );
  }

  async reportVerification(
    id: string,
    outcome: "passed" | "failed",
    summary: string,
    verificationSteps?: string
  ): Promise<WorkUnitDTO> {
    return this.request<WorkUnitDTO>(
      "POST",
      `/api/work-units/${encodeURIComponent(id)}/report-verification`,
      verificationSteps !== undefined
        ? { outcome, summary, verificationSteps }
        : { outcome, summary }
    );
  }

  /**
   * Uploads a local image as a work-unit attachment. Bespoke (not routed
   * through the shared `request` helper below): that helper always
   * JSON-encodes its body, but the existing attachments endpoint expects
   * multipart/form-data with the file under a "file" field.
   */
  async addAttachment(
    workUnitId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<AttachmentDTO> {
    const path = `/api/work-units/${encodeURIComponent(workUnitId)}/attachments`;
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([buffer as BlobPart], { type: mimeType }),
      filename
    );

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Ponder API error: ${response.status} POST ${path}`);
    }

    return (await response.json()) as AttachmentDTO;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      ...(body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });

    if (!response.ok) {
      throw new Error(`Ponder API error: ${response.status} ${method} ${path}`);
    }

    return (await response.json()) as T;
  }
}
