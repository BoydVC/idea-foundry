import { DomainError, type IdeaId, type PrUrl, type Spec, type SpecId, prUrl, specId, ideaId } from "./domain.js";

export const FORBID = ["merge", "deploy", "send"] as const;

export type ArenaPacket = {
  protocol: "dd-intake/v1";
  command: "intake";
  specId: SpecId;
  ideaId: IdeaId;
  title: string;
  body: string;
  acceptance: readonly string[];
  touch: readonly string[];
  maxChangedLines: number;
  stackIndex: number;
  landsAfter: SpecId | null;
  requiresDraftPr: true;
  forbid: readonly ["merge", "deploy", "send"];
};

export type ReportDoc = {
  verdict: "verified" | "rejected";
  draft: boolean;
  pr: PrUrl | null;
  body: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildPacket(spec: Spec): ArenaPacket {
  return {
    protocol: "dd-intake/v1",
    command: "intake",
    specId: spec.id,
    ideaId: spec.ideaId,
    title: spec.title,
    body: spec.body,
    acceptance: spec.acceptance,
    touch: spec.touch,
    maxChangedLines: spec.maxLines,
    stackIndex: spec.index,
    landsAfter: spec.landsAfter,
    requiresDraftPr: true,
    forbid: FORBID,
  };
}

export function parsePacket(input: unknown): ArenaPacket {
  if (!isRecord(input)) {
    throw new DomainError("bad_packet", "The arena packet must be a JSON object.", "Run `foundry dispatch <spec-id>` again.");
  }
  if (input.protocol !== "dd-intake/v1" || input.command !== "intake") {
    throw new DomainError("bad_packet", "The packet protocol must be dd-intake/v1 intake.", "Write the packet with `foundry dispatch`.");
  }
  if (input.requiresDraftPr !== true) {
    throw new DomainError("not_draft", "An intake packet must require a draft pull request.", "Set requiresDraftPr to true.");
  }
  const forbid = input.forbid;
  if (!Array.isArray(forbid) || FORBID.some((item) => !forbid.includes(item))) {
    throw new DomainError("bad_packet", "The packet must forbid merge, deploy, and send.", "Keep the forbid list from dispatch.");
  }
  const landsRaw = input.landsAfter;
  return {
    protocol: "dd-intake/v1",
    command: "intake",
    specId: specId(String(input.specId)),
    ideaId: ideaId(String(input.ideaId)),
    title: String(input.title),
    body: String(input.body),
    acceptance: Array.isArray(input.acceptance) ? input.acceptance.map(String) : [],
    touch: Array.isArray(input.touch) ? input.touch.map(String) : [],
    maxChangedLines: Number(input.maxChangedLines),
    stackIndex: Number(input.stackIndex),
    landsAfter: landsRaw === null ? null : specId(String(landsRaw)),
    requiresDraftPr: true,
    forbid: FORBID,
  };
}

export function parseReport(text: string): ReportDoc {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new DomainError(
      "bad_report",
      "The report needs front matter.",
      "Start the report with verdict, draft, and pr between --- lines.",
    );
  }
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const split = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (split?.[1]) fields.set(split[1], (split[2] ?? "").trim());
  }
  const verdict = fields.get("verdict");
  if (verdict !== "verified" && verdict !== "rejected") {
    throw new DomainError("bad_report", "verdict must be verified or rejected.", "Set verdict: verified or verdict: rejected.");
  }
  const draftRaw = fields.get("draft");
  const draft = draftRaw === "true";
  const prRaw = fields.get("pr");
  const pr = prRaw && prRaw.length > 0 ? prUrl(prRaw) : null;
  return { verdict, draft, pr, body: (match[2] ?? "").trim() };
}

export function renderReport(input: { verdict: "verified" | "rejected"; draft: boolean; pr: string; title: string }): string {
  return [
    "---",
    `verdict: ${input.verdict}`,
    `draft: ${input.draft ? "true" : "false"}`,
    `pr: ${input.pr}`,
    "---",
    "",
    `Synthetic verification note for ${input.title}.`,
    "Merge is forbidden.",
    "",
  ].join("\n");
}
