/**
 * PonderClient — a thin HTTP client over Ponder's existing REST API.
 *
 * Every method maps to an existing Ponder endpoint so that behavior (e.g.
 * moving a card triggers the JIRA status write-back) is reused with zero
 * duplication. This client performs no business logic of its own.
 */

import type { Column, ProjectWithStats, StoryDTO, WorkUnitDTO } from "@/lib/types";

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
