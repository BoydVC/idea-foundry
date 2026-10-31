import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { approve, createIdea, decompose, dispatch, gate, restate } from "../src/commands.js";
import { FixturePlanner } from "../src/planner.js";
import { Store } from "../src/store.js";
import { acceptIntake } from "../scripts/accept-draft-day.js";

const planner = new FixturePlanner();

describe("Draft Day intake", () => {
  test("dd intake --from-inbox accepts a dispatched Foundry packet", () => {
    const root = mkdtempSync(join(tmpdir(), "foundry-dd-"));
    const store = new Store(root, () => "2026-01-01T00:00:00.000Z");
    const made = createIdea(store, "habit tracker export", false);
    if (!made.ok) throw new Error("create");
    const id = (made.data as { id: string }).id;
    restate(store, id, planner, false);
    approve(store, id, "Ship the smallest slice", false);
    decompose(store, id, planner, false);
    const gated = gate(store, id, false);
    if (!gated.ok) throw new Error(JSON.stringify(gated));
    const bottom = store.load().specs.find((spec) => spec.ideaId === id && spec.index === 1);
    if (!bottom) throw new Error("missing spec");
    const sent = dispatch(store, bottom.id, false);
    expect(sent.ok).toBe(true);
    const accepted = acceptIntake(join(root, "intake.jsonl"));
    expect(accepted.status).toBe("intake");
    expect(accepted.pickId).toMatch(/^p-/);
  }, 120_000);
});