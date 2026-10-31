import { describe, expect, it } from "vitest";
import { checkG1, checkG2, checkG3, lintSpec, nextAfterGate, verifyBlocked, type SpecText } from "../src/gates.ts";
import { FixturePlanner, SEED_TITLES, countSeedSpecs } from "../src/planner.ts";
import type { Spec } from "../src/domain.ts";

const clean: SpecText = {
  title: "Export the habit log",
  summary: "Write the sample habit log to a CSV file.",
  doneWhen: "the export command prints a CSV header.",
  acceptance: ["npm test -- habit-export"],
  touch: ["src/habits/export.ts"],
  maxChangedLines: 80,
  piiClause: "Synthetic data only. No personal data.",
  body: "",
};

clean.body = [
  `# ${clean.title}`,
  clean.summary,
  `Done when: ${clean.doneWhen}`,
  "PII clause: Synthetic data only. No personal data.",
  "This spec does not merge. It opens a draft pull request only.",
].join("\n");

describe("gates", () => {
  it("passes G1 for a runnable command, a touch map, and a small size", () => {
    expect(checkG1(clean).pass).toBe(true);
  });

  it("fails G1 when the command, touch map, or size is missing", () => {
    expect(checkG1({ ...clean, acceptance: [] }).codes).toContain("g1-acceptance");
    expect(checkG1({ ...clean, touch: ["../secret.ts"] }).codes).toContain("g1-touch");
    expect(checkG1({ ...clean, maxChangedLines: 401 }).codes).toContain("g1-size");
  });

  it("passes G2 when done-when, concrete verbs, and the PII clause are present", () => {
    expect(checkG2(clean).pass).toBe(true);
  });

  it("fails G2 for a missing done-when, a vague verb, or a missing PII clause", () => {
    expect(checkG2({ ...clean, doneWhen: "", body: clean.body.replace(/Done when:.*\n/, "") }).codes).toContain("g2-done-when");
    expect(checkG2({ ...clean, summary: "Improve the layout.", body: `${clean.body}\nImprove the layout.` }).codes).toContain("g2-vague");
    expect(checkG2({ ...clean, piiClause: "", body: clean.body.replace("Synthetic data only. No personal data.", "looks fine") }).codes).toContain("g2-pii");
  });

  it("passes G3 when the spec refuses to merge and opens a draft", () => {
    expect(checkG3(clean).pass).toBe(true);
  });

  it("fails G3 when the spec contains a merge command or drops the draft line", () => {
    expect(checkG3({ ...clean, body: `${clean.body}\ngh pr merge 1` }).codes).toContain("g3-merge");
    expect(checkG3({ ...clean, body: "Done when: something observable happens.\n" }).codes).toContain("g3-draft");
  });

  it("moves a gated spec back to specced when a gate fails", () => {
    const results = lintSpec({ ...clean, maxChangedLines: 900 });
    expect(nextAfterGate("gated", results)).toEqual({ ok: true, state: "specced" });
    expect(nextAfterGate("specced", lintSpec(clean))).toEqual({ ok: true, state: "gated" });
  });

  it("blocks verification while a lower spec is not verified", () => {
    const lower = { ideaId: "i-0001", index: 1, id: "s-0001-1", state: "dispatched" } as Spec;
    const upper = { ideaId: "i-0001", index: 2, id: "s-0001-2", state: "dispatched" } as Spec;
    expect(verifyBlocked(upper, [lower, upper])).toContain("s-0001-1");
    expect(verifyBlocked(upper, [{ ...lower, state: "verified" }, upper])).toBeNull();
  });
});

describe("fixture planner", () => {
  const planner = new FixturePlanner();

  it("turns the five seed ideas into at least 14 specs", () => {
    expect(SEED_TITLES).toHaveLength(5);
    expect(countSeedSpecs()).toBeGreaterThanOrEqual(14);
    const specs = SEED_TITLES.flatMap((title) => planner.decompose(title, planner.restate(title).restatement));
    expect(specs).toHaveLength(countSeedSpecs());
    const weather = specs.filter((spec) => spec.title.toLowerCase().includes("weather") || spec.summary.toLowerCase().includes("weather"));
    expect(weather.some((spec) => !checkG2(spec).pass)).toBe(true);
    const habit = planner.decompose("habit tracker export", "sample");
    expect(habit.every((spec) => lintSpec(spec).every((gate) => gate.pass))).toBe(true);
  });
});
