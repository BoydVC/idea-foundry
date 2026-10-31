import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jar = join(root, "tools", "tla2tools.jar");
const jarUrl = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar";

let cached: { ok: true; detail: string } | null = null;

function jarReady(): boolean {
  if (spawnSync("test", ["-f", jar]).status === 0) return true;
  spawnSync("mkdir", ["-p", join(root, "tools")]);
  const lock = `${jar}.lockdir`;
  const claimed = spawnSync("mkdir", [lock]);
  if (claimed.status !== 0) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      spawnSync("sleep", ["0.1"]);
      if (spawnSync("test", ["-f", jar]).status === 0) return true;
    }
    return false;
  }
  const part = `${jar}.part`;
  const fetched = spawnSync("curl", ["-fsSL", "-o", part, jarUrl], { encoding: "utf8" });
  const moved = fetched.status === 0 ? spawnSync("mv", ["-f", part, jar]) : { status: 1 };
  spawnSync("rmdir", [lock]);
  return moved.status === 0 && spawnSync("test", ["-f", jar]).status === 0;
}

export function checkFoundryModel(): { ok: boolean; detail: string } {
  if (cached) return cached;
  if (!jarReady()) return { ok: false, detail: "tla2tools.jar is not available." };
  const ran = spawnSync(
    "java",
    ["-XX:+UseParallelGC", "-Xmx512m", "-jar", jar, "-workers", "1", "-config", "foundry.cfg", "foundry.tla"],
    { cwd: join(root, "model"), encoding: "utf8" },
  );
  const detail = `${ran.stdout ?? ""}\n${ran.stderr ?? ""}`.trim();
  const ok = ran.status === 0 && detail.includes("No error has been found");
  if (ok) cached = { ok: true, detail };
  return { ok, detail };
}
