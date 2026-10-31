import { spawnSync } from "node:child_process";

const GITHUB_PR = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)$/;

export const NOT_GITHUB_WARNING =
  "GitHub API was not called because the URL is not a github.com pull request. Using the report line.";

export const OFFLINE_WARNING = "GitHub API was unreachable. The report line was not used.";

export const TEST_MODE_WARNING = "FOUNDRY_GITHUB_DRAFT=offline is test mode. Using the report line.";

export const BAD_BODY_WARNING = "GitHub API returned no draft flag. The report line was not used.";

export const RATE_LIMIT_WARNING = "GitHub API rate limit reached. Not using the report line.";

export const API_FAILURE_WARNING = "GitHub API rejected the lookup. Not using the report line.";

export const PR_NOT_FOUND_WARNING = "GitHub API returned HTTP 404 for this pull request. Not using the report line.";

export const PROBE_AUTH_WARNING = "GitHub API refused the lookup (HTTP 401). Not using the report line.";

export const PROBE_FORBIDDEN_WARNING = "GitHub API refused the lookup (HTTP 403). Not using the report line.";

export type ProbeCode = "pr_not_found" | "probe_auth" | "rate_limit" | "api_failure" | "offline";

export type DraftProbeResult =
  | { ok: true; draft: boolean; closed?: boolean }
  | { ok: false; warning: string; trustReport?: boolean; code?: ProbeCode; httpStatus?: number };

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
): { draft: boolean; closed: boolean; withheld: boolean; warning?: string; message: string; next: string; code?: ProbeCode; httpStatus?: number } {
  const message = "Ingest refuses a pull request that is not a draft.";
  const next = "Open the pull request as a draft, then ingest again.";
  if (typeof pr !== "string" || pr.length === 0) {
    return { draft: reportDraft, closed: false, withheld: false, message, next };
  }
  const probed = probe(pr);
  if (!probed.ok) {
    const testMode = (probed.warning ?? "").includes("test mode");
    const unconfirmed =
      !testMode && (probed.trustReport === false || probed.code === "offline" || /unreachable|did not confirm/i.test(probed.warning ?? ""));
    if (unconfirmed) {
      const code = probed.code ?? "api_failure";
      const refused = code === "pr_not_found" || code === "probe_auth";
      return {
        draft: false,
        closed: false,
        withheld: true,
        warning: probed.warning,
        code,
        httpStatus: probed.httpStatus,
        message: refused
          ? code === "pr_not_found"
            ? "GitHub says this pull request was not found. The report line was not used."
            : "GitHub refused the lookup. The report line was not used."
          : "GitHub could not confirm the pull request. The spec stays dispatched.",
        next: refused
          ? code === "pr_not_found"
            ? "Check the pull request URL, then ingest again."
            : "Check gh auth, then ingest again."
          : "Retry with `foundry ingest <id> --recheck` when GitHub is reachable.",
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
    return { ok: false, warning: BAD_BODY_WARNING, trustReport: false, code: "offline" };
  }
  if (typeof parsed.draft !== "boolean") return { ok: false, warning: BAD_BODY_WARNING, trustReport: false, code: "offline" };
  const merged = (parsed as { merged?: unknown }).merged === true;
  return { ok: true, draft: parsed.draft, closed: parsed.state === "closed" || parsed.state === "merged" || merged };
}

const NETWORK = /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|unable to connect|could not resolve|network is unreachable|dial tcp/i;
const RATE = /rate limit|HTTP 429|secondary rate/i;
const NETWORK_CODES = new Set(["ENOENT", "ETIMEDOUT", "ABORT_ERR", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]);

function httpCode(output: string): number | null {
  const header = output.match(/HTTP\s+(\d{3})/i);
  if (header?.[1]) return Number(header[1]);
  const status = output.match(/"status"\s*:\s*"?(\d{3})"?/);
  if (status?.[1]) return Number(status[1]);
  return null;
}

export function interpretGithubProbe(input: GithubProbeInput): DraftProbeResult {
  const output = `${input.stdout}\n${input.stderr}`;
  if (input.errorCode !== undefined && NETWORK_CODES.has(input.errorCode)) {
    return { ok: false, warning: OFFLINE_WARNING, trustReport: false, code: "offline" };
  }
  if (RATE.test(output)) return { ok: false, warning: RATE_LIMIT_WARNING, trustReport: false, code: "rate_limit" };
  if (input.status === 0) return parsePullStatus((input.stdout ?? "").trim());
  const code = httpCode(output);
  if (code === 404) return { ok: false, warning: PR_NOT_FOUND_WARNING, trustReport: false, code: "pr_not_found" };
  if (code === 401) return { ok: false, warning: PROBE_AUTH_WARNING, trustReport: false, code: "probe_auth", httpStatus: 401 };
  if (code === 403) return { ok: false, warning: PROBE_FORBIDDEN_WARNING, trustReport: false, code: "probe_auth", httpStatus: 403 };
  if (code !== null && code >= 500) return { ok: false, warning: API_FAILURE_WARNING, trustReport: false, code: "api_failure" };
  if (input.status === null || NETWORK.test(output)) return { ok: false, warning: OFFLINE_WARNING, trustReport: false, code: "offline" };
  return { ok: false, warning: API_FAILURE_WARNING, trustReport: false, code: "api_failure" };
}

export function lookupGithubDraft(pr: string): DraftProbeResult {
  if (process.env.FOUNDRY_GITHUB_DRAFT === "offline") {
    return { ok: false, warning: TEST_MODE_WARNING, code: "offline" };
  }
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
