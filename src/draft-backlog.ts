import { spawnSync } from "node:child_process";

export const DRAFT_LIMIT = 10;

export const OFFLINE_DRAFT_WARNING = "GitHub API was unreachable. Dispatch is continuing without a draft count.";

export const NON_NUMERIC_DRAFT_WARNING = "GitHub returned a draft count that is not a number. Dispatch is continuing without a draft count.";

export const WEEKLY_DRAFT_WARNING = "GitHub did not return an open-draft count for the target repo. targetOpenDrafts is null.";

export type DraftBacklog = { ok: true; drafts: number } | { ok: false; warning: string };

export type DraftBacklogProbe = (target: string) => DraftBacklog;

export function draftBacklogFromGh(ran: { error?: unknown; status: number | null; stdout?: string | null }): DraftBacklog {
  if (ran.error || ran.status === null || ran.status !== 0) return { ok: false, warning: OFFLINE_DRAFT_WARNING };
  const count = Number((ran.stdout ?? "").trim());
  if (!Number.isInteger(count) || count < 0) return { ok: false, warning: NON_NUMERIC_DRAFT_WARNING };
  return { ok: true, drafts: count };
}

export function lookupOpenDrafts(target: string): DraftBacklog {
  const ran = spawnSync(
    "gh",
    ["api", "-X", "GET", "search/issues", "-f", `q=repo:${target} is:pr is:open is:draft`, "--jq", ".total_count"],
    { encoding: "utf8", timeout: 8000 },
  );
  return draftBacklogFromGh({ error: ran.error, status: ran.status, stdout: ran.stdout });
}

export function draftBacklogFromEnv(env: NodeJS.ProcessEnv = process.env): DraftBacklogProbe {
  return (target) => {
    if (env.FOUNDRY_OPEN_DRAFTS !== undefined && env.FOUNDRY_OPEN_DRAFTS !== "") {
      const count = Number(env.FOUNDRY_OPEN_DRAFTS);
      if (!Number.isInteger(count) || count < 0) return { ok: false, warning: OFFLINE_DRAFT_WARNING };
      return { ok: true, drafts: count };
    }
    if (env.FOUNDRY_DRAFT_PROBE === "offline") return { ok: false, warning: OFFLINE_DRAFT_WARNING };
    return lookupOpenDrafts(target);
  };
}

export function backlogDecision(result: DraftBacklog, limit = DRAFT_LIMIT): { refuse: boolean; warning?: string; message: string; next: string } {
  const next = `Wait until the target has ${limit} or fewer open draft pull requests, then run \`foundry dispatch\` again.`;
  if (!result.ok) {
    return { refuse: false, warning: result.warning, message: result.warning, next };
  }
  if (result.drafts > limit) {
    return {
      refuse: true,
      message: `The target has ${result.drafts} open draft pull requests, above the limit of ${limit}.`,
      next,
    };
  }
  return { refuse: false, message: `${result.drafts} open draft pull requests.`, next };
}
