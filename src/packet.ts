import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DomainError, type IdeaId, type PrUrl, type Spec, type SpecId, prUrl, specId, ideaId } from "./domain.js";

export const FORBID = ["merge", "deploy", "send"] as const;
export const DEFAULT_TARGET = "BoydVC/draft-day";
const TARGET = /^BoydVC\/[A-Za-z0-9._-]+$/;

export type IntakeLine = {
  ts: string;
  idea: string;
  source: "foundry";
  target: string;
  n: 3;
};

export function parseTarget(value: string): string {
  const target = value.trim();
  if (!TARGET.test(target)) {
    throw new DomainError(
      "bad_target",
      "Draft Day accepts a target of BoydVC/<repo> that is listed in its targets.json.",
      "Use BoydVC/draft-day, which the stock Draft Day allowlist already contains.",
    );
  }
  return target;
}

export const RUNNER_SEATS = ["types-first", "model-first", "experience-first"] as const;
export type RunnerSeatName = (typeof RUNNER_SEATS)[number];

export type RunnerSeat = {
  seat: RunnerSeatName;
  model?: string;
};

export type PacketVerifier = { base: "pick"; graft: true };

export type PacketPrompts = {
  runners: readonly { seat: RunnerSeatName; text: string }[];
  verifier: string;
};

export const DEFAULT_RUNNERS: readonly RunnerSeat[] = [
  { seat: "types-first", model: "claude-opus-5-5-xhigh" },
  { seat: "model-first", model: "grok-4.7-xhigh-fast" },
  { seat: "experience-first", model: "claude-sonnet-5-5-high" },
];

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
  runners: readonly RunnerSeat[];
  verifier: PacketVerifier;
  prompts: PacketPrompts;
  intake: IntakeLine;
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

const templateCache = new Map<string, string>();

function readTemplate(name: string): string {
  const cached = templateCache.get(name);
  if (cached) return cached;
  const path = join(dirname(fileURLToPath(import.meta.url)), "../prompts", name);
  const ran = spawnSync("cat", [path], { encoding: "utf8" });
  if (ran.status !== 0 || !ran.stdout) {
    throw new DomainError("bad_packet", `Missing prompt template ${name}.`, "Restore prompts/runner.md and prompts/verifier.md.");
  }
  templateCache.set(name, ran.stdout);
  return ran.stdout;
}

function fill(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{([a-z]+)\}\}/g, (_match, key: string) => fields[key] ?? "");
}

export function renderPrompts(spec: Pick<Spec, "title" | "body" | "acceptance" | "touch">, runners: readonly RunnerSeat[]): PacketPrompts {
  const runnerTemplate = readTemplate("runner.md");
  const verifierTemplate = readTemplate("verifier.md");
  const shared = {
    title: spec.title,
    body: spec.body,
    acceptance: spec.acceptance.join("\n"),
    touch: spec.touch.join("\n"),
  };
  return {
    runners: runners.map((runner) => ({
      seat: runner.seat,
      text: fill(runnerTemplate, { ...shared, seat: runner.seat, model: runner.model ?? "parent" }),
    })),
    verifier: fill(verifierTemplate, shared),
  };
}

function parseRunners(raw: unknown): RunnerSeat[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new DomainError("bad_packet", "An arena packet needs at least 2 runner seats.", "Dispatch again so the packet has types-first, model-first, and experience-first.");
  }
  const seats: RunnerSeat[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.seat !== "string" || !(RUNNER_SEATS as readonly string[]).includes(item.seat)) {
      throw new DomainError("bad_packet", "Runner seats must be types-first, model-first, or experience-first.", "Dispatch the spec again.");
    }
    if (seen.has(item.seat)) {
      throw new DomainError("bad_packet", "Runner seats must be structurally distinct.", "Give each runner a different seat.");
    }
    seen.add(item.seat);
    const seat = item.seat as RunnerSeatName;
    const model = item.model === undefined ? undefined : String(item.model);
    seats.push(model ? { seat, model } : { seat });
  }
  return seats;
}

function parsePrompts(raw: unknown, runners: readonly RunnerSeat[]): PacketPrompts {
  if (!isRecord(raw) || !Array.isArray(raw.runners) || typeof raw.verifier !== "string" || raw.verifier.trim() === "") {
    throw new DomainError("bad_packet", "The packet needs rendered runner and verifier prompts.", "Dispatch the spec again.");
  }
  if (raw.runners.length !== runners.length) {
    throw new DomainError("bad_packet", "Each runner seat needs a prompt.", "Dispatch the spec again.");
  }
  const prompts: { seat: RunnerSeatName; text: string }[] = [];
  for (let index = 0; index < runners.length; index += 1) {
    const item = raw.runners[index];
    const runner = runners[index];
    if (!runner || !isRecord(item) || item.seat !== runner.seat || typeof item.text !== "string" || item.text.trim() === "") {
      throw new DomainError("bad_packet", "A runner prompt is missing.", "Dispatch the spec again.");
    }
    prompts.push({ seat: runner.seat, text: item.text });
  }
  return { runners: prompts, verifier: raw.verifier };
}

export function buildPacket(spec: Spec, target = DEFAULT_TARGET, ts = new Date().toISOString(), runners: readonly RunnerSeat[] = DEFAULT_RUNNERS): ArenaPacket {
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
    runners,
    verifier: { base: "pick", graft: true },
    prompts: renderPrompts(spec, runners),
    intake: {
      ts,
      idea: spec.title,
      source: "foundry",
      target: parseTarget(target),
      n: 3,
    },
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
  const intake = input.intake;
  if (
    !isRecord(intake) ||
    intake.source !== "foundry" ||
    intake.n !== 3 ||
    typeof intake.idea !== "string" ||
    typeof intake.ts !== "string"
  ) {
    throw new DomainError(
      "bad_packet",
      "The packet needs an intake line with ts, idea, source, target, and n.",
      "Dispatch the spec again so intake.jsonl matches Draft Day's inbox.",
    );
  }
  const target = parseTarget(String(intake.target));
  const runners = parseRunners(input.runners);
  const verifier = input.verifier;
  if (!isRecord(verifier) || verifier.base !== "pick" || verifier.graft !== true) {
    throw new DomainError("bad_packet", "The packet verifier must pick a base and graft.", "Set verifier to { base: pick, graft: true }.");
  }
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
    runners,
    verifier: { base: "pick", graft: true },
    prompts: parsePrompts(input.prompts, runners),
    intake: { ts: String(intake.ts), idea: String(intake.idea), source: "foundry", target, n: 3 },
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
