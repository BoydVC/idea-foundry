import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { STATES, type State } from "../src/domain.ts";
import { parseGuards, parseTransitionTable } from "../src/model-table.ts";
import { renderStatechart } from "../src/statechart.ts";
import { transition, type Event, type EventName } from "../src/transition.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelText = fs.readFileSync(path.join(root, "model", "foundry.tla"), "utf8");
const names: EventName[] = [
  "restate",
  "approve",
  "decompose",
  "gate_pass",
  "gate_fail",
  "dispatch",
  "ingest_verified",
  "ingest_rejected",
  "park",
];

function eventFor(name: EventName): Event {
  if (name === "ingest_verified") {
    return { type: "ingest_verified", draft: true, belowVerified: true };
  }
  return { type: name };
}

test("transition matches the TLA table and refuses every other pair", () => {
  const rows = parseTransitionTable(modelText);
  const legal = new Set(rows.map((row) => `${row.from}|${row.event}`));
  for (const row of rows) {
    const result = transition(row.from as State, eventFor(row.event as EventName));
    expect(result).toMatchObject({ ok: true, state: row.to });
  }
  for (const state of STATES) {
    for (const name of names) {
      const key = `${state}|${name}`;
      if (legal.has(key)) {
        continue;
      }
      const result = transition(state, eventFor(name));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.state).toBe(state);
        expect(result.next.length).toBeGreaterThan(0);
      }
    }
  }
});

test("ingest guards from the model block a non-draft and a skipped lower spec", () => {
  const guards = parseGuards(modelText);
  expect(guards).toContainEqual({ event: "ingest_verified", guard: "draft" });
  expect(guards).toContainEqual({ event: "ingest_verified", guard: "belowVerified" });
  const notDraft = transition("dispatched", { type: "ingest_verified", draft: false, belowVerified: true });
  const skipped = transition("dispatched", { type: "ingest_verified", draft: true, belowVerified: false });
  expect(notDraft).toMatchObject({ ok: false, state: "dispatched" });
  expect(skipped).toMatchObject({ ok: false, state: "dispatched" });
});

test("statechart.mmd is generated from the model table", () => {
  const rows = parseTransitionTable(modelText);
  const expected = renderStatechart(rows);
  const file = fs.readFileSync(path.join(root, "statechart.mmd"), "utf8");
  expect(file).toBe(expected);
});

type MergedIsIllegal = "merged" extends State ? never : true;
const mergedIsIllegal: MergedIsIllegal = true;
test("merged is not a state", () => {
  expect(mergedIsIllegal).toBe(true);
  expect(STATES.includes("merged" as State)).toBe(false);
});
