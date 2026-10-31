import type { Finding, GateResult, Spec, SpecId } from "./domain.js";

const VAGUE = /\b(improve|enhance|optimize|leverage|streamline|handle|manage)\b/i;
const RUNNABLE = /^(node|npm|npx|tsc)(\s+\S+)+$/;
const MERGE_ORDER = /\byou may merge\b|\bauto-merge\b|\bmerge the pull request\b/i;

function result(gate: GateResult["gate"], findings: Finding[]): GateResult {
  return { gate, pass: findings.length === 0, findings };
}

export function checkG1(spec: Pick<Spec, "acceptance" | "touch" | "maxLines">): GateResult {
  const findings: Finding[] = [];
  if (!spec.acceptance.some((command) => RUNNABLE.test(command))) {
    findings.push({
      key: "g1:acceptance",
      detail: "Add an acceptance command that starts with node, npm, npx, or tsc.",
    });
  }
  if (spec.touch.length === 0) {
    findings.push({ key: "g1:touch", detail: "Add a touch map of the files this spec may change." });
  }
  if (spec.touch.some((path) => path.startsWith("/") || path.includes(".."))) {
    findings.push({ key: "g1:touch-escape", detail: "Keep every touch path inside the repo." });
  }
  if (spec.maxLines > 400) {
    findings.push({ key: "g1:size", detail: "Keep the change at or under 400 lines." });
  }
  return result("G1", findings);
}

export function checkG2(spec: Pick<Spec, "body">): GateResult {
  const findings: Finding[] = [];
  if (!spec.body.includes("Done when:")) {
    findings.push({ key: "g2:done-when", detail: "Add a Done when: line." });
  }
  if (!spec.body.includes("PII clause:")) {
    findings.push({ key: "g2:pii", detail: "Add a PII clause: line that limits the spec to synthetic data." });
  }
  const vague = spec.body.match(VAGUE);
  const word = vague?.[1];
  if (word) {
    findings.push({ key: "g2:vague-verb", detail: `Replace the vague verb "${word}".` });
  }
  return result("G2", findings);
}

export function checkG3(
  spec: { body: string; index: number; landsAfter: string | null; id: string },
  siblings: readonly { id: string; index: number }[],
): GateResult {
  const findings: Finding[] = [];
  if (!spec.body.includes("Merge is forbidden.")) {
    findings.push({ key: "g3:no-merge", detail: "State that merge is forbidden." });
  }
  if (!/draft PR/i.test(spec.body)) {
    findings.push({ key: "g3:draft", detail: "State that the proof is a draft PR." });
  }
  if (MERGE_ORDER.test(spec.body)) {
    findings.push({ key: "g3:merge-instruction", detail: "Remove the instruction to merge." });
  }
  if (spec.index > 1) {
    const below = siblings.find((item) => item.index === spec.index - 1);
    if (!below || spec.landsAfter !== below.id) {
      findings.push({
        key: "g3:stack-order",
        detail: "Point landsAfter at the spec directly below this one.",
      });
    }
  }
  return result("G3", findings);
}

export function sharedTouchFindings(
  spec: { id: string; touch: readonly string[] },
  siblings: readonly { id: string; touch: readonly string[] }[],
): Finding[] {
  const findings: Finding[] = [];
  for (const file of spec.touch) {
    for (const other of siblings) {
      if (other.id === spec.id) continue;
      if (!other.touch.includes(file)) continue;
      findings.push({ key: "g1:blast", detail: `${file} is also touched by ${other.id}.` });
    }
  }
  return findings;
}

export function checkSpec(spec: Spec, siblings: readonly Spec[]): GateResult[] {
  const base = checkG1(spec);
  return [result("G1", [...base.findings, ...sharedTouchFindings(spec, siblings)]), checkG2(spec), checkG3(spec, siblings)];
}

export function passed(gates: readonly GateResult[]): boolean {
  return gates.length === 3 && gates.every((gate) => gate.pass);
}

export function siblingId(siblings: readonly Spec[], index: number): SpecId | null {
  return siblings.find((item) => item.index === index)?.id ?? null;
}
