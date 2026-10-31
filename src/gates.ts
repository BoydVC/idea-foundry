import type { GateId, GateResult, Spec, SpecId } from "./domain.ts";

const VAGUE = ["improve", "enhance", "optimize", "tweak", "leverage", "utilize", "better", "stuff", "things", "various"];

const COMMAND = /^(node|npm|npx)(\s|$)/;

export type TlcView = { ok: boolean; detail: string };

export function evaluateGates(
  spec: Spec,
  ctx: { specs: readonly Spec[]; tlc: TlcView; bannedPhrases: readonly string[]; at: string },
): GateResult[] {
  return [
    result(spec.id, "G1", gate1(spec), ctx.at),
    result(spec.id, "G2", gate2(spec, ctx.bannedPhrases), ctx.at),
    result(spec.id, "G3", gate3(ctx.specs, ctx.tlc), ctx.at),
  ];
}

export function gate1(spec: Spec): string[] {
  const reasons: string[] = [];
  if (spec.acceptance.length < 1) {
    reasons.push("Spec needs at least one acceptance check.");
  }
  for (const check of spec.acceptance) {
    if (!COMMAND.test(check.command.trim())) {
      reasons.push(`Acceptance command is not runnable: ${check.command}`);
    }
  }
  if (spec.touchMap.length < 1) {
    reasons.push("Spec needs a touch map.");
  }
  for (const file of spec.touchMap) {
    if (file.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(file)) {
      reasons.push(`Touch map path is not allowed: ${file}`);
    }
  }
  if (!Number.isInteger(spec.maxChangedLines) || spec.maxChangedLines < 1 || spec.maxChangedLines > 400) {
    reasons.push("Spec size must be an integer from 1 to 400 changed lines.");
  }
  return reasons;
}

export function gate2(spec: Spec, bannedPhrases: readonly string[]): string[] {
  const reasons: string[] = [];
  if (!spec.doneWhen.trim()) {
    reasons.push('Spec is missing a "done when" clause.');
  }
  if (!spec.body.toLowerCase().includes("done when")) {
    reasons.push('Spec body is missing the words "done when".');
  }
  if (!spec.piiClause.toLowerCase().includes("synthetic")) {
    reasons.push("Spec is missing a synthetic-data clause.");
  }
  const haystack = `${spec.title}\n${spec.body}\n${spec.doneWhen}`.toLowerCase();
  for (const word of VAGUE) {
    const hit = new RegExp(`\\b${word}\\b`, "i").test(haystack);
    if (hit) {
      reasons.push(`Spec uses the vague verb "${word}".`);
    }
  }
  for (const phrase of bannedPhrases) {
    if (phrase && haystack.includes(phrase.toLowerCase())) {
      reasons.push(`Spec repeats a lesson phrase: ${phrase}`);
    }
  }
  return reasons;
}

export function gate3(specs: readonly Spec[], tlc: TlcView): string[] {
  const reasons = liveInvariantReasons(specs);
  if (!tlc.ok) {
    reasons.push("TLC did not pass model/foundry.tla.");
  }
  return reasons;
}

export function liveInvariantReasons(specs: readonly Spec[]): string[] {
  const reasons: string[] = [];
  for (const spec of specs) {
    if (spec.state === "verified" && spec.draftPr !== true) {
      reasons.push(`${spec.id} is verified without a draft PR.`);
    }
  }
  const byIdea = new Map<string, Spec[]>();
  for (const spec of specs) {
    const list = byIdea.get(spec.ideaId) ?? [];
    list.push(spec);
    byIdea.set(spec.ideaId, list);
  }
  for (const list of byIdea.values()) {
    const ordered = [...list].sort((a, b) => a.order - b.order);
    for (let index = 1; index < ordered.length; index += 1) {
      const upper = ordered[index];
      const lower = ordered[index - 1];
      if (upper && lower && upper.state === "verified" && lower.state !== "verified") {
        reasons.push(`${upper.id} is verified while ${lower.id} is ${lower.state}.`);
      }
    }
  }
  return reasons;
}

function result(specId: SpecId, gate: GateId, reasons: string[], at: string): GateResult {
  return { specId, gate, pass: reasons.length === 0, reasons, at };
}
