/**
 * Thin fetch-based GitHub REST client — no SDK dependency. One call per
 * repo returns the 100 most-recently-updated PRs. Failures (bad token,
 * unknown repo, rate limit, network) come back as { warning } instead of
 * throwing: one bad repo must never break a sync.
 */

export interface PrSummary {
  number: number;
  title: string;
  headRef: string;
  state: "open" | "closed";
  merged: boolean;
  url: string;
}

export type FetchPrsResult = PrSummary[] | { warning: string };

interface GitHubPrResponse {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  html_url: string;
  head: { ref: string };
}

export async function fetchRecentPrs(
  repo: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchPrsResult> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      return { warning: `${repo}: ${response.status} ${response.statusText}` };
    }

    const body = (await response.json()) as GitHubPrResponse[];
    return body.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      state: pr.state === "open" ? ("open" as const) : ("closed" as const),
      merged: pr.merged_at !== null,
      url: pr.html_url,
    }));
  } catch (error) {
    return {
      warning: `${repo}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
