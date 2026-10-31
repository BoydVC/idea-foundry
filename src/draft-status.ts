import { spawnSync } from "node:child_process";

const GITHUB_PR = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)$/;

export const NOT_GITHUB_WARNING =
  "GitHub API was not called because the URL is not a github.com pull request. Using the report line.";

export const OFFLINE_WARNING = "GitHub API was unreachable. Using the report line.";

export const BAD_BODY_WARNING = "GitHub API returned no draft flag. Using the report line.";

export type DraftProbeResult = { ok: true; draft: boolean } | { ok: false; warning: string };

export type DraftProbe = (pr: string) => DraftProbeResult;

export function resolveDraftStatus(
  reportDraft: boolean,
  pr: string | undefined,
  probe: DraftProbe,
): { draft: boolean; warning?: string; message: string; next: string } {
  const message = "Ingest refuses a pull request that is not a draft.";
  const next = "Open the pull request as a draft, then ingest again.";
  if (typeof pr !== "string" || pr.length === 0) {
    return { draft: reportDraft, message, next };
  }
  const probed = probe(pr);
  if (!probed.ok) return { draft: reportDraft, warning: probed.warning, message, next };
  if (!probed.draft) {
    return {
      draft: false,
      message: "GitHub says this pull request is not a draft.",
      next: "Mark the pull request as a draft, then ingest again.",
    };
  }
  return { draft: true, message, next };
}

export function lookupGithubDraft(pr: string): DraftProbeResult {
  const match = GITHUB_PR.exec(pr.trim());
  if (!match) return { ok: false, warning: NOT_GITHUB_WARNING };
  const owner = match[1] ?? "";
  const repo = match[2] ?? "";
  const number = match[3] ?? "";
  const ran = spawnSync(
    "gh",
    ["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, "--jq", ".draft"],
    { encoding: "utf8", timeout: 8000 },
  );
  if (ran.error || ran.status !== 0) return { ok: false, warning: OFFLINE_WARNING };
  const text = (ran.stdout ?? "").trim();
  if (text === "true") return { ok: true, draft: true };
  if (text === "false") return { ok: true, draft: false };
  return { ok: false, warning: BAD_BODY_WARNING };
}
