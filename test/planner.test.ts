import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { canonicalTouch, isRunnable } from "../src/gates.js";
import { AgentPlanner, recordedComplete, type RecordedBook } from "../src/planners/llm.js";
import { FixturePlanner, SEED_TITLES } from "../src/planner.js";

const book = JSON.parse(readFileSync("fixtures/planner-records.json", "utf8")) as RecordedBook;

function assertDrafts(drafts: readonly { acceptance: readonly string[]; touch: readonly string[]; sketch: { types: string; signatures: readonly string[] }; title: string }[]) {
  expect(drafts.length).toBeGreaterThanOrEqual(2);
  for (const draft of drafts) {
    expect(draft.acceptance.some((command) => isRunnable(command))).toBe(true);
    expect(draft.touch.every((path) => canonicalTouch(path) !== null)).toBe(true);
    expect(draft.sketch.types.trim().length).toBeGreaterThan(0);
    expect(draft.sketch.signatures.length).toBeGreaterThan(0);
    expect(draft.sketch.signatures.join("\n")).toContain("not implemented");
  }
}

describe("planners", () => {
  test("fixture and recorded agent plans are runnable sketches", () => {
    const fixture = new FixturePlanner();
    const agent = new AgentPlanner(recordedComplete(book));
    for (const title of SEED_TITLES) {
      assertDrafts(fixture.decompose(title));
      assertDrafts(agent.decompose(title));
      const restated = agent.restate(title);
      expect(restated.restatement).toContain("Goal:");
      expect(restated.restatement).toContain("Problem:");
      expect(restated.restatement).toContain("Smallest change:");
      expect(restated.restatement).toContain("Done when:");
      expect(restated.questions).toHaveLength(3);
    }
  });

  test("a recorded agent response gives two ideas different slice names", () => {
    const agent = new AgentPlanner(recordedComplete(book));
    const habit = agent.decompose("habit tracker export").map((draft) => draft.title);
    const weather = agent.decompose("weather widget").map((draft) => draft.title);
    expect(habit).toEqual(["habit tracker export: ledger", "habit tracker export: rollup"]);
    expect(weather).toEqual(["weather widget: card", "weather widget: empty-state"]);
    expect(habit).not.toEqual(weather);
  });
});
