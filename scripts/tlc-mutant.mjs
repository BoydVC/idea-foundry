import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [join(root, "scripts", "tlc.mjs"), "foundry_mutant"], {
  cwd: root,
  encoding: "utf8",
});
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
process.stdout.write(output);
const failedOnSkip = (result.status ?? 1) !== 0 && output.includes("DispatchRequiresGate is violated");
const failedOnDraft = output.includes("VerifiedImpliesDraftPR is violated");
if (!failedOnSkip || failedOnDraft) {
  process.stderr.write("The mutant was expected to violate DispatchRequiresGate and keep VerifiedImpliesDraftPR.\n");
  process.exit(1);
}
process.exit(0);
