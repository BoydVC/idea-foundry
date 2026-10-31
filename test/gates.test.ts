import { expect, test } from "vitest";
import type { Spec, SpecId, IdeaId } from "../src/domain.ts";
import { evaluateGates, gate1, gate2, gate3, liveInvariantReasons } from "../src/gates.ts";

const at = "2026-01-15T00:00:00.000Z";

function spec(patch: Partial<Spec> = {}): Spec {
  return {
    kind: "spec",
    id: "s-0001-1" as SpecId,
    ideaId: "i-0001" as IdeaId,
    version: 1,
    state: "specced",
    order: 1,
    title: "Write the export file",
    doneWhen: "the writer saves a JSON export with one object per fixture row.",
    body: "Add a writer.\n\nThis spec is done when the writer saves a JSON export with one object per fixture row.\n\nSynthetic data only.",
    acceptance: [{ command: "node -e \"process.exit(0)\"", description: "The writer exits 0." }],
    touchMap: ["src/habits/write.ts"],
    maxChangedLines: 90,
    piiClause: "Synthetic data only. No personal names, contact details, or locations.",
    draftPr: null,
    prUrl: null,
    reportExcerpt: null,
    ...patch,
  };
}

test("G1 passes a runnable check, a touch map, and a size under 400", () => {
  expect(gate1(spec())).toEqual([]);
});

test("G1 fails when the acceptance command, touch map, or size is missing", () => {
  const reasons = gate1(spec({ acceptance: [], touchMap: ["../secrets.txt"], maxChangedLines: 401 }));
  expect(reasons.join(" ")).toMatch(/acceptance check/);
  expect(reasons.join(" ")).toMatch(/not allowed/);
  expect(reasons.join(" ")).toMatch(/400/);
});

test("G2 passes a done-when line, a concrete verb, and a synthetic-data clause", () => {
  expect(gate2(spec(), [])).toEqual([]);
});

test("G2 fails on a missing done when, a vague verb, or a missing synthetic clause", () => {
  const reasons = gate2(
    spec({
      doneWhen: "",
      body: "improve the stuff",
      piiClause: "looks fine",
    }),
    [],
  );
  expect(reasons.join(" ")).toMatch(/done when/);
  expect(reasons.join(" ")).toMatch(/vague verb/);
  expect(reasons.join(" ")).toMatch(/synthetic/);
});

test("G3 passes when TLC passed and live invariants hold", () => {
  expect(gate3([spec()], { ok: true, detail: "pass" })).toEqual([]);
});

test("G3 fails when TLC failed or a higher spec is verified first", () => {
  const model = gate3([spec()], { ok: false, detail: "fail" });
  expect(model.join(" ")).toMatch(/TLC/);
  const lower = spec({ id: "s-0001-1" as SpecId, order: 1, state: "gated" });
  const upper = spec({
    id: "s-0001-2" as SpecId,
    order: 2,
    state: "verified",
    draftPr: true,
  });
  expect(liveInvariantReasons([lower, upper]).join(" ")).toMatch(/s-0001-2/);
  const results = evaluateGates(upper, {
    specs: [lower, upper],
    tlc: { ok: true, detail: "pass" },
    bannedPhrases: [],
    at,
  });
  expect(results.find((gate) => gate.gate === "G3")?.pass).toBe(false);
});

test("a repeated lesson phrase fails G2", () => {
  const reasons = gate2(spec({ body: "This spec is done when the writer saves a file.\nplaceholder acceptance\nSynthetic data only." }), [
    "placeholder acceptance",
  ]);
  expect(reasons.join(" ")).toMatch(/lesson phrase/);
});
