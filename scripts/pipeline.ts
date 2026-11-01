import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { approve, createIdea, decompose, dispatch, gate, restate } from "../src/commands.js";
import { draftBacklogFromEnv, type DraftBacklogProbe } from "../src/draft-backlog.js";
import { FixturePlanner } from "../src/planner.js";
import { Store } from "../src/store.js";
import { acceptIntake } from "./accept-draft-day.js";

export type PipelineResult =
  | { ok: true; idea: string; spec: string; target: string; draftDay: { pickId: string; status: string } }
  | { ok: false; error: string; message: string };

const DEMO_PROBE: DraftBacklogProbe = () => ({ ok: true, drafts: 0 });

export function runPipeline(options: { probe?: DraftBacklogProbe; live?: boolean } = {}): PipelineResult {
  const live = options.live === true || process.env.FOUNDRY_LIVE_BACKLOG === "1";
  const probe = live ? (options.probe ?? draftBacklogFromEnv()) : DEMO_PROBE;
  const root = mkdtempSync(join(tmpdir(), "foundry-pipeline-"));
  const store = new Store(root);
  const planner = new FixturePlanner();
  try {
    const idea = createIdea(store, "habit tracker export", false);
    if (!idea.ok) return { ok: false, error: idea.error, message: idea.message };
    const id = (idea.data as { id: string }).id;
    const restated = restate(store, id, planner, false);
    if (!restated.ok) return { ok: false, error: restated.error, message: restated.message };
    const approved = approve(store, id, "Ship the smallest slice", false);
    if (!approved.ok) return { ok: false, error: approved.error, message: approved.message };
    const decomposed = decompose(store, id, planner, false);
    if (!decomposed.ok) return { ok: false, error: decomposed.error, message: decomposed.message };
    const gated = gate(store, id, false);
    if (!gated.ok) return { ok: false, error: gated.error, message: gated.message };
    const bottom = store.load().specs.find((spec) => spec.ideaId === id && spec.index === 1);
    if (!bottom) return { ok: false, error: "missing_spec", message: "decompose did not write a bottom spec" };
    const sent = dispatch(store, bottom.id, false, undefined, probe);
    if (!sent.ok) return { ok: false, error: sent.error, message: sent.message };
    const accepted = acceptIntake(join(root, "intake.jsonl"));
    return { ok: true, idea: id, spec: bottom.id, target: "BoydVC/draft-day", draftDay: accepted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The pipeline failed.";
    return { ok: false, error: "pipeline", message };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  if (process.env.FOUNDRY_LIVE_BACKLOG !== "1") process.env.FOUNDRY_OPEN_DRAFTS = "0";
  const result = runPipeline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}
