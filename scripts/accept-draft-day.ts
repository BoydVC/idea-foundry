import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DRAFT_DAY_SHA = "fa266c249405c25db0b900ce0cc5d3a0fd744ce7";

export function ensureDraftDay(): string {
  return checkout();
}

function checkout(): string {
  const root = join(process.cwd(), "vendor", "draft-day");
  const current = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (current.status === 0 && current.stdout.trim() === DRAFT_DAY_SHA && spawnSync("test", ["-f", join(root, "src/cli/dd.ts")]).status === 0) {
    return root;
  }
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const init = spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
  if (init.status !== 0) throw new Error(init.stderr || "git init failed");
  spawnSync("git", ["remote", "add", "origin", "https://github.com/BoydVC/draft-day.git"], { cwd: root });
  const fetched = spawnSync("git", ["fetch", "--depth", "1", "origin", DRAFT_DAY_SHA], { cwd: root, encoding: "utf8" });
  if (fetched.status !== 0) throw new Error(fetched.stderr || "could not fetch Draft Day");
  const checked = spawnSync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: root, encoding: "utf8" });
  if (checked.status !== 0) throw new Error(checked.stderr || "could not check out Draft Day");
  return root;
}

export function acceptIntake(intakePath: string): { pickId: string; status: string } {
  const repo = checkout();
  const data = mkdtempSync(join(tmpdir(), "dd-intake-"));
  try {
    cpSync(intakePath, join(data, "intake.jsonl"));
    const ran = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "src/cli/dd.ts", "intake", "--from-inbox", "--json", "--data", data],
      { cwd: repo, encoding: "utf8" },
    );
    if (ran.status !== 0) {
      throw new Error((ran.stderr || ran.stdout || "dd intake failed").trim());
    }
    const parsed = JSON.parse(ran.stdout) as { picks?: { pickId: string; status: string }[] };
    const pick = parsed.picks?.[0];
    if (!pick?.pickId) throw new Error(`Draft Day returned no pick: ${ran.stdout}`);
    return { pickId: pick.pickId, status: pick.status };
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}

const calledDirectly = process.argv[1]?.endsWith("accept-draft-day.ts");
if (calledDirectly) {
  const intake = process.argv[2];
  if (!intake) {
    process.stderr.write("Pass the path to intake.jsonl\n");
    process.exit(1);
  }
  const result = acceptIntake(intake);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
