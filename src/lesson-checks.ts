import type { Finding, Lesson } from "./domain.js";
import { checkG1, checkG2, checkG3, sharedTouchFindings, typecheckSketch, sketchSource } from "./gates.js";

type LessonSpec = {
  id: string;
  index: number;
  landsAfter: string | null;
  maxLines: number;
  acceptance: readonly string[];
  touch: readonly string[];
  body: string;
  sketch?: { types: string; signatures: readonly string[] };
};

export const LESSON_CHECKS: Record<string, (spec: LessonSpec, siblings: readonly { id: string; index: number; touch: readonly string[] }[]) => Finding | null> = {
  "g0:sketch": (spec) => {
    if (!spec.sketch) return { key: "g0:sketch", detail: "Add an architect sketch with types and signatures.", proof: 1 };
    const source = sketchSource(spec.sketch);
    if (!source.includes("not implemented")) {
      return { key: "g0:sketch", detail: "Sketch signatures must keep not implemented bodies until the runner fills them in.", proof: 1 };
    }
    const checked = typecheckSketch(source);
    return checked.ok ? null : { key: "g0:sketch", detail: `The sketch does not typecheck. ${checked.detail}`.trim(), proof: 4 };
  },
  "g0:unenforced-lesson": () => null,
  "g1:acceptance": (spec) => checkG1(spec).findings.find((item) => item.key === "g1:acceptance") ?? null,
  "g1:touch": (spec) => checkG1(spec).findings.find((item) => item.key === "g1:touch") ?? null,
  "g1:touch-escape": (spec) => checkG1(spec).findings.find((item) => item.key === "g1:touch-escape") ?? null,
  "g1:size": (spec) => checkG1(spec).findings.find((item) => item.key === "g1:size") ?? null,
  "g1:proof": (spec) => checkG1(spec).findings.find((item) => item.key === "g1:proof") ?? null,
  "g1:blast": (spec, siblings) => sharedTouchFindings(spec, siblings)[0] ?? null,
  "g1:tlc": () => null,
  "g2:done-when": (spec) => checkG2(spec).findings.find((item) => item.key === "g2:done-when") ?? null,
  "g2:pii": (spec) => checkG2(spec).findings.find((item) => item.key === "g2:pii") ?? null,
  "g2:vague-verb": (spec) => checkG2(spec).findings.find((item) => item.key === "g2:vague-verb") ?? null,
  "g3:no-merge": (spec, siblings) => checkG3(spec, siblings).findings.find((item) => item.key === "g3:no-merge") ?? null,
  "g3:draft": (spec, siblings) => checkG3(spec, siblings).findings.find((item) => item.key === "g3:draft") ?? null,
  "g3:merge-instruction": (spec, siblings) => checkG3(spec, siblings).findings.find((item) => item.key === "g3:merge-instruction") ?? null,
  "g3:stack-order": (spec, siblings) => checkG3(spec, siblings).findings.find((item) => item.key === "g3:stack-order") ?? null,
  "g3:tlc": () => null,
};

export function lessonFindings(
  spec: LessonSpec,
  siblings: readonly { id: string; index: number; touch: readonly string[] }[],
  lessons: readonly Pick<Lesson, "key" | "promotedTo" | "detail">[],
): Finding[] {
  const findings: Finding[] = [];
  for (const lesson of lessons) {
    if (lesson.key.startsWith("g3:reject-")) continue;
    const check = LESSON_CHECKS[lesson.key];
    if (!check) {
      findings.push({
        key: "g0:unenforced-lesson",
        detail: `Lesson ${lesson.key} repeated and has no automated check. Encode it in LESSON_CHECKS before the gate can pass. ${lesson.detail}`,
        proof: 2,
      });
      continue;
    }
    const found = check(spec, siblings);
    if (found) findings.push(found);
  }
  return findings;
}
