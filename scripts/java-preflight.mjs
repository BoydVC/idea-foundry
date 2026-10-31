import { spawnSync } from "node:child_process";

export function javaOnPath() {
  const ran = spawnSync("java", ["-version"], { encoding: "utf8" });
  return ran.status === 0;
}

export function requireJava(kind) {
  if (javaOnPath()) return;
  const install = "Install a JDK 21 (see README Prerequisites).";
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    process.stderr.write(`ERROR: Java is not on PATH. ${kind} cannot be skipped in CI. ${install}\n`);
    process.exit(1);
  }
  process.stderr.write(`SKIP: Java is not on PATH. ${kind} did not run. ${install}\n`);
  process.exit(0);
}
