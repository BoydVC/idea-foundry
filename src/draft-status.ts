import { spawnSync } from "node:child_process";

const GITHUB_PR = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)$/;

export const NOT_GITHUB_WARNING =
  "GitHub API was not called because the URL is not a github.com pull request. Using the report line.";

export const OFFLINE_WARNING = "GitHub API was unreachable. Using the report line.";

export const BAD_BODY_WARNING = "GitHub API returned no draft flag. Using the report line.";

export const RATE_LIMIT_WARNING = "GitHub API rate limit reached. Not using the report line.";

export const API_FAILURE_WARNING = "GitHub API rejected the lookup. Not using the report line.";

export type DraftProbeResult = { ok: true; draft: boolean; closed?: boolean } | { ok: false; warning: string; trustReport?: boolean };

export type GithubProbeInput = {
  status: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
};

export type DraftProbe = (pr: string) => DraftProbeResult;

export function resolveDraftStatus(
  reportDraft: boolean,
  pr: string | undefined,
  probe: DraftProbe,
): { draft: boolean; closed: boolean; withheld: boolean; warning?: string; message: string; next: string } {
  const message = "Ingest refuses a pull request that is not a draft.";
  const next = "Open the pull request as a draft, then ingest again.";
  if (typeof pr !== "string" || pr.length === 0) {
    return { draft: reportDraft, closed: false, withheld: false, message, next };
  }
  const probed = probe(pr);
  if (!probed.ok) {
    if (probed.trustReport === false) {
      return {
        draft: false,
        closed: false,
        withheld: true,
        warning: probed.warning,
        message: "GitHub did not confirm the pull request. The report line was not used.",
        next: "Retry when the GitHub API accepts the lookup.",
      };
    }
    return { draft: reportDraft, closed: false, withheld: false, warning: probed.warning, message, next };
  }
  if (probed.closed) {
    return {
      draft: false,
      closed: true,
      withheld: false,
      message: "GitHub says this pull request is closed.",
      next: "Open a new draft pull request, then ingest again.",
    };
  }
  if (!probed.draft) {
    return {
      draft: false,
      closed: false,
      withheld: false,
      message: "GitHub says this pull request is not a draft.",
      next: "Mark the pull request as a draft, then ingest again.",
    };
  }
  return { draft: true, closed: false, withheld: false, message, next };
}

export function parsePullStatus(text: string): DraftProbeResult {
  let parsed: { draft?: unknown; state?: unknown };
  try {
    parsed = JSON.parse(text) as { draft?: unknown; state?: unknown };
  } catch {
    return { ok: false, warning: BAD_BODY_WARNING };
  }
  if (typeof parsed.draft !== "boolean") return { ok: false, warning: BAD_BODY_WARNING };
  const merged = (parsed as { merged?: unknown }).merged === true;
  return { ok: true, draft: parsed.draft, closed: parsed.state === "closed" || parsed.state === "merged" || merged };
}

const NETWORK = /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|unable to connect|could not resolve|network is unreachable|dial tcp/i;
const RATE = /rate limit|HTTP 429|secondary rate/i;

export function interpretGithubProbe(input: GithubProbeInput): DraftProbeResult {
  const output = `${input.stdout}\n${input.stderr}`;
  if (
    input.errorCode === "ENOENT" ||
    input.errorCode === "ETIMEDOUT" ||
    input.errorCode === "ABORT_ERR" ||
    input.errorCode === "ECONNRESET" ||
    input.errorCode === "ENOTFOUND" ||
    input.errorCode === "EAI_AGAIN"
  ) {
    return { ok: false, warning: OFFLINE_WARNING };
  }
  if (RATE.test(output)) return { ok: false, warning: RATE_LIMIT_WARNING, trustReport: false };
  if (input.status === 0) return parsePullStatus((input.stdout ?? "").trim());
  if (input.status === null || NETWORK.test(output)) return { ok: false, warning: OFFLINE_WARNING };
  if (/HTTP 5\d\d/i.test(output)) return { ok: false, warning: API_FAILURE_WARNING, trustReport: false };
  return { ok: false, warning: OFFLINE_WARNING };
}

export function lookupGithubDraft(pr: string): DraftProbeResult {
  const match = GITHUB_PR.exec(pr.trim());
  if (!match) return { ok: false, warning: NOT_GITHUB_WARNING };
  const owner = match[1] ?? "";
  const repo = match[2] ?? "";
  const number = match[3] ?? "";
  const ran = spawnSync(
    "gh",
    ["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, "--jq", "{draft:.draft,state:.state,merged:.merged}"],
    { encoding: "utf8", timeout: 8000 },
  );
  return interpretGithubProbe({
    status: ran.status,
    stdout: ran.stdout ?? "",
    stderr: ran.stderr ?? "",
    errorCode: (ran.error as NodeJS.ErrnoException | undefined)?.code,
  });
}
