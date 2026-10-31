import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function tlcJar(): string {
  return process.env.TLA2TOOLS ?? "/tmp/tlc/tla2tools.jar";
}

export function checkModel(configName: string, root = packageRoot()): { ok: boolean; detail: string; exitCode: number | null } {
  const jar = tlcJar();
  const metadir = path.join(
    os.tmpdir(),
    `foundry-tlc-${process.pid}-${configName.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`,
  );
  spawnSync("mkdir", ["-p", metadir]);
  const ran = spawnSync(
    "java",
    [
      "-XX:+UseParallelGC",
      "-Xmx1g",
      "-cp",
      jar,
      "tlc2.TLC",
      "-workers",
      "1",
      "-config",
      configName,
      "-metadir",
      metadir,
      "foundry.tla",
    ],
    { cwd: path.join(root, "model"), encoding: "utf8" },
  );
  const detail = `${ran.stdout ?? ""}\n${ran.stderr ?? ""}`.trim();
  return { ok: ran.status === 0, detail, exitCode: ran.status };
}
