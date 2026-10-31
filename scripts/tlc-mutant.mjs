import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireJava } from "./java-preflight.mjs";

requireJava("TLC mutants");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function shortestPath(output, invariant) {
  const marker = `Invariant ${invariant} is violated.`;
  const at = output.indexOf(marker);
  if (at < 0) return null;
  const slice = output.slice(at);
  const window = slice.split(/\nTLC2 /)[0] ?? slice;
  const kept = [];
  for (const match of window.matchAll(/State \d+: <([^>\n]+)>/g)) {
    const label = (match[1] ?? "").split(" line ")[0]?.trim();
    if (label) kept.push(label);
  }
  if (kept.length === 0) return null;
  return `shortest path for ${invariant}: ${kept.join(" -> ")}`;
}

function run(config) {
  const result = spawnSync(process.execPath, [join(root, "scripts", "tlc.mjs"), "foundry", config], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  process.stdout.write(output);
  return { status: result.status ?? 1, output };
}

const skip = run("foundry_skip_gate");
const skipPath = shortestPath(skip.output, "DispatchRequiresGate");
if (skipPath) process.stdout.write(`${skipPath}\n`);
const skipOk =
  skip.status !== 0 &&
  skip.output.includes("DispatchRequiresGate is violated") &&
  !skip.output.includes("VerifiedImpliesDraftPR is violated") &&
  skipPath !== null;
if (!skipOk) {
  process.stderr.write("Skip-gate config must violate DispatchRequiresGate and keep VerifiedImpliesDraftPR.\n");
  process.exit(1);
}

const merged = run("foundry_merge");
const mergePath = shortestPath(merged.output, "NoMergeState");
if (mergePath) process.stdout.write(`${mergePath}\n`);
if (merged.status === 0 || !merged.output.includes("NoMergeState is violated") || mergePath === null) {
  process.stderr.write("Merge config must violate NoMergeState.\n");
  process.exit(1);
}

const lost = run("foundry_lost");
const lostPath = shortestPath(lost.output, "CASNoLostUpdate");
if (lostPath) process.stdout.write(`${lostPath}\n`);
if (lost.status === 0 || !lost.output.includes("CASNoLostUpdate is violated") || lostPath === null) {
  process.stderr.write("Lost-update config must violate CASNoLostUpdate.\n");
  process.exit(1);
}

const undone = run("foundry_undo");
const undoPath = shortestPath(undone.output, "VerifiedIsFinal");
if (undoPath) process.stdout.write(`${undoPath}\n`);
if (undone.status === 0 || !undone.output.includes("VerifiedIsFinal is violated") || undoPath === null) {
  process.stderr.write("Undo config must violate VerifiedIsFinal.\n");
  process.exit(1);
}

process.exit(0);
