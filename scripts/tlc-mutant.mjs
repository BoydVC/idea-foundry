import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
const skipOk = skip.status !== 0 && skip.output.includes("DispatchRequiresGate is violated") && !skip.output.includes("VerifiedImpliesDraftPR is violated");
if (!skipOk) {
  process.stderr.write("Skip-gate config must violate DispatchRequiresGate and keep VerifiedImpliesDraftPR.\n");
  process.exit(1);
}

const merged = run("foundry_merge");
if (merged.status === 0 || !merged.output.includes("NoMergeState is violated")) {
  process.stderr.write("Merge config must violate NoMergeState.\n");
  process.exit(1);
}

const lost = run("foundry_lost");
if (lost.status === 0 || !lost.output.includes("CASNoLostUpdate is violated")) {
  process.stderr.write("Lost-update config must violate CASNoLostUpdate.\n");
  process.exit(1);
}

process.exit(0);
