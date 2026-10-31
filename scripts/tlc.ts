import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkModel, packageRoot, tlcJar } from "../src/tlc.ts";

const jar = tlcJar();
if (!fs.existsSync(jar)) {
  fs.mkdirSync(path.dirname(jar), { recursive: true });
  const fetched = spawnSync(
    "curl",
    ["-fsSL", "-o", jar, "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"],
    { stdio: "inherit" },
  );
  if (fetched.status !== 0) {
    process.stderr.write("Could not download tla2tools.jar. Set TLA2TOOLS and retry.\n");
    process.exit(1);
  }
}

const root = packageRoot();
const honest = checkModel("foundry.cfg", root);
process.stdout.write(honest.detail + "\n");
if (!honest.ok) {
  process.stderr.write("TLC failed on model/foundry.cfg\n");
  process.exit(honest.exitCode ?? 1);
}
const mutated = checkModel("foundry_skip_gate.cfg", root);
process.stdout.write(mutated.detail + "\n");
if (mutated.ok || !mutated.detail.includes("DispatchRequiresGate is violated")) {
  process.stderr.write("Skip-gate mutation must fail DispatchRequiresGate.\n");
  process.exit(1);
}
process.stdout.write("TLC pass. Skip-gate mutation failed as required.\n");
