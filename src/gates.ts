import { transition, type GateResult, type Spec, type State } from "./domain.ts";

const VAGUE = ["improve", "enhance", "optimize", "leverage", "streamline", "tweak"];
const COMMAND = /^(npm|npx|node|vitest|bash)(\s+\S.*)?$/;
const META = /[;&|<>`$]/;
const TOUCH = /^[a-z0-9._/-]+$/i;

export interface SpecText {
  title: string;
  summary: string;
  doneWhen: string;
  acceptance: string[];
  touch: string[];
  maxChangedLines: number;
  piiClause: string;
  body: string;
}

export function checkG1(spec: SpecText): GateResult {
  const reasons: string[] = [];
  const codes: string[] = [];
  if (
    spec.acceptance.length === 0 ||
    spec.acceptance.some((command) => !COMMAND.test(command) || META.test(command) || command.length > 180)
  ) {
    reasons.push("Add at least one acceptance command such as npm test or node scripts/check.mjs.");
    codes.push("g1-acceptance");
  }
  if (spec.touch.length === 0 || spec.touch.some((file) => !TOUCH.test(file) || file.includes(".."))) {
    reasons.push("Add a touch map of repo-relative paths.");
    codes.push("g1-touch");
  }
  if (!Number.isInteger(spec.maxChangedLines) || spec.maxChangedLines < 1 || spec.maxChangedLines > 400) {
    reasons.push("Keep the spec at or under 400 changed lines.");
    codes.push("g1-size");
  }
  return { gate: "G1", pass: reasons.length === 0, reasons, codes };
}

export function checkG2(spec: SpecText): GateResult {
  const reasons: string[] = [];
  const codes: string[] = [];
  const blob = `${spec.title}\n${spec.summary}\n${spec.doneWhen}\n${spec.body}`;
  if (spec.doneWhen.trim().length < 8 || !/done when:/i.test(spec.body)) {
    reasons.push("Add a Done when line that says how to tell the slice is finished.");
    codes.push("g2-done-when");
  }
  const vague = VAGUE.filter((verb) => new RegExp(`\\b${verb}\\b`, "i").test(blob));
  if (vague.length > 0) {
    reasons.push(`Replace the vague verb ${vague.map((verb) => `"${verb}"`).join(", ")} with a check you can run.`);
    codes.push("g2-vague");
  }
  const pii = spec.body.toLowerCase();
  if (!pii.includes("synthetic data only") || !pii.includes("no personal data") || spec.piiClause.trim().length < 8) {
    reasons.push("Add a PII clause that says synthetic data only and no personal data.");
    codes.push("g2-pii");
  }
  return { gate: "G2", pass: reasons.length === 0, reasons, codes };
}

export function checkG3(spec: SpecText): GateResult {
  const reasons: string[] = [];
  const codes: string[] = [];
  if (/\bgh\s+pr\s+merge\b/i.test(spec.body) || /\bgit\s+merge\b/i.test(spec.body)) {
    reasons.push("Remove the merge command. This spec must not merge.");
    codes.push("g3-merge");
  }
  const body = spec.body.toLowerCase();
  if (!body.includes("does not merge") || !body.includes("draft pull request")) {
    reasons.push("Say that the spec does not merge and that it opens a draft pull request.");
    codes.push("g3-draft");
  }
  return { gate: "G3", pass: reasons.length === 0, reasons, codes };
}

export function lintSpec(spec: SpecText): GateResult[] {
  return [checkG1(spec), checkG2(spec), checkG3(spec)];
}

export function nextAfterGate(state: State, results: readonly GateResult[]): ReturnType<typeof transition> {
  const pass = results.every((result) => result.pass);
  return transition(state, { type: pass ? "gate_pass" : "gate_fail" });
}

export function verifyBlocked(spec: Pick<Spec, "ideaId" | "index">, siblings: readonly Spec[]): string | null {
  const waiting = siblings
    .filter((other) => other.ideaId === spec.ideaId && other.index < spec.index && other.state !== "verified")
    .map((other) => other.id);
  if (waiting.length === 0) return null;
  return `Ingest ${waiting.join(", ")} first. A higher spec cannot be verified while a lower one is not.`;
}

export const LESSON_CHECKS: Record<string, { gate: "G1" | "G2" | "G3"; check: string }> = {
  "g1-acceptance": {
    gate: "G1",
    check: "Every spec needs a runnable acceptance command.",
  },
  "g1-touch": {
    gate: "G1",
    check: "Every spec needs a touch map of repo paths.",
  },
  "g1-size": {
    gate: "G1",
    check: "Every spec must stay at or under 400 changed lines.",
  },
  "g2-done-when": {
    gate: "G2",
    check: "Every spec needs a Done when line.",
  },
  "g2-vague": {
    gate: "G2",
    check: "Reject a spec that uses a vague verb where a runnable check belongs.",
  },
  "g2-pii": {
    gate: "G2",
    check: "Every spec needs a clause that says synthetic data only and no personal data.",
  },
  "g3-merge": {
    gate: "G3",
    check: "A spec must not contain a merge command.",
  },
  "g3-draft": {
    gate: "G3",
    check: "A spec must say that it opens a draft pull request and does not merge.",
  },
  "g3-order": {
    gate: "G3",
    check: "Keep a higher spec unverified until the spec below it is verified.",
  },
};
