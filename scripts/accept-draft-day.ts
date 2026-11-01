import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DRAFT_DAY_SHA = "fa266c249405c25db0b900ce0cc5d3a0fd744ce7";

const MARKER = ".foundry-sha";

export function ensureDraftDay(): string {
  return checkout();
}

function ready(root: string): boolean {
  const marker = join(root, MARKER);
  return (
    existsSync(join(root, "src/cli/dd.ts")) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === DRAFT_DAY_SHA &&
    !existsSync(join(root, ".git"))
  );
}

function waitMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(lock: string): boolean {
  try {
    closeSync(openSync(lock, "wx"));
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    try {
      if (Date.now() - statSync(lock).mtimeMs > 120_000) {
        unlinkSync(lock);
        return acquire(lock);
      }
    } catch {
      /* raced with the holder */
    }
    return false;
  }
}

function gzipFile(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const magic = Buffer.alloc(2);
    const read = readSync(fd, magic, 0, 2, 0);
    return read === 2 && magic[0] === 0x1f && magic[1] === 0x8b;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function downloadTarball(archive: string): void {
  const gh = spawnSync("gh", ["api", `repos/BoydVC/draft-day/tarball/${DRAFT_DAY_SHA}`], {
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!gh.error && gh.status === 0 && gh.stdout && gh.stdout.length > 0) {
    writeFileSync(archive, gh.stdout);
    if (gzipFile(archive)) return;
  }
  const url = `https://codeload.github.com/BoydVC/draft-day/tar.gz/${DRAFT_DAY_SHA}`;
  const curl = spawnSync("curl", ["-fsSL", url, "-o", archive], { encoding: "utf8", timeout: 120_000 });
  if (curl.status !== 0 || !gzipFile(archive)) {
    const detail = (curl.stderr || gh.stderr?.toString() || "could not download the Draft Day tarball").trim();
    throw new Error(detail);
  }
}

function install(root: string): void {
  const scratch = mkdtempSync(join(tmpdir(), "dd-tarball-"));
  try {
    const archive = join(scratch, "draft-day.tar.gz");
    downloadTarball(archive);
    const extracted = join(scratch, "extract");
    mkdirSync(extracted);
    const untar = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
    if (untar.status !== 0) throw new Error(untar.stderr || "could not extract the Draft Day tarball");
    const tops = readdirSync(extracted, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const top = tops.length === 1 ? join(extracted, tops[0]?.name ?? "") : extracted;
    if (!existsSync(join(top, "src/cli/dd.ts"))) throw new Error("The Draft Day tarball has no src/cli/dd.ts.");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, ".."), { recursive: true });
    cpSync(top, root, { recursive: true });
    rmSync(join(root, ".git"), { recursive: true, force: true });
    writeFileSync(join(root, MARKER), `${DRAFT_DAY_SHA}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkout(): string {
  const root = join(process.cwd(), "vendor", "draft-day");
  if (ready(root)) return root;
  mkdirSync(join(process.cwd(), "vendor"), { recursive: true });
  const lock = join(process.cwd(), "vendor", ".draft-day.lock");
  if (!acquire(lock)) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (ready(root)) return root;
      waitMs(500);
    }
    if (ready(root)) return root;
    throw new Error("Timed out waiting for the Draft Day tarball.");
  }
  try {
    if (!ready(root)) install(root);
    return root;
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already released */
    }
  }
}

export function acceptIntake(intakePath: string): { pickId: string; status: string } {
  const repo = checkout();
  const data = mkdtempSync(join(tmpdir(), "dd-intake-"));
  try {
    cpSync(intakePath, join(data, "intake.jsonl"));
    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const ran = spawnSync(
      process.execPath,
      [tsx, join(repo, "src/cli/dd.ts"), "intake", "--from-inbox", "--json", "--data", data],
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
