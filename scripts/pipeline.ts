import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve, createIdea, decompose, dispatch, gate, restate } from "../src/commands.js";
import { FixturePlanner } from "../src/planner.js";
import { Store } from "../src/store.js";
import { acceptIntake } from "./accept-draft-day.js";

const root = mkdtempSync(join(tmpdir(), "foundry-pipeline-"));
const store = new Store(root);
const planner = new FixturePlanner();

function must<T>(result: { ok: true; data: T } | { ok: false; message: string }, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.message}`);
  return result.data;
}

try {
  const idea = must(createIdea(store, "habit tracker export", false) as { ok: true; data: { id: string } } | { ok: false; message: string }, "idea");
  const id = idea.id;
  must(restate(store, id, planner, false) as { ok: true; data: unknown } | { ok: false; message: string }, "restate");
  must(approve(store, id, "Ship the smallest slice", false) as { ok: true; data: unknown } | { ok: false; message: string }, "approve");
  must(decompose(store, id, planner, false) as { ok: true; data: unknown } | { ok: false; message: string }, "decompose");
  must(gate(store, id, false) as { ok: true; data: unknown } | { ok: false; message: string }, "gate");
  const bottom = store.load().specs.find((spec) => spec.ideaId === id && spec.index === 1);
  if (!bottom) throw new Error("decompose did not write a bottom spec");
  must(dispatch(store, bottom.id, false) as { ok: true; data: unknown } | { ok: false; message: string }, "dispatch");
  const accepted = acceptIntake(join(root, "intake.jsonl"));
  process.stdout.write(
    `${JSON.stringify({ ok: true, idea: id, spec: bottom.id, target: "BoydVC/draft-day", draftDay: accepted }, null, 2)}\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
