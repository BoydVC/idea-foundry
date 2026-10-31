import { mkdtempSync, readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { builtinTerms, scanText } from "../src/pii.js";

const root = process.cwd();
const allow = new Set([".ts", ".js", ".mjs", ".css", ".html", ".md", ".json", ".yml", ".yaml", ".mmd", ".tla", ".cfg"]);
const skip = new Set(["node_modules", "dist", "data", "tools", ".git", "test-results", "playwright-report", ".local", "vendor"]);
const denylistPath = process.env.FOUNDRY_DENYLIST ?? join(root, ".local", "pii-denylist.txt");
const gifPath = join(root, "screenshots", "demo.gif");

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push(path);
  }
}

function ensureDenylist(): string[] {
  mkdirSync(join(root, ".local"), { recursive: true });
  if (!existsSync(denylistPath)) {
    const body = ["# Local denylist. Do not commit this file.", ...builtinTerms(), ""].join("\n");
    writeFileSync(denylistPath, body);
  }
  return readFileSync(denylistPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function toolMissing(name: string): boolean {
  const ran = spawnSync(name, ["--version"], { encoding: "utf8" });
  return (ran.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function requireScanTools(): void {
  const missing = ["ffmpeg", "tesseract"].filter((name) => toolMissing(name));
  if (missing.length === 0) return;
  const error = `${missing.join(" and ")} is not installed. npm run pii OCRs screenshots/demo.gif and needs tesseract and ffmpeg. TLC needs a JDK 21. See README Prerequisites.`;
  process.stdout.write(`${JSON.stringify({ ok: false, error }, null, 2)}\n`);
  process.exit(1);
}

function ocrGif(): { frames: number; text: string } {
  if (!existsSync(gifPath)) return { frames: 0, text: "" };
  const dir = mkdtempSync(join(tmpdir(), "foundry-ocr-"));
  try {
    const extracted = spawnSync("ffmpeg", ["-y", "-i", gifPath, join(dir, "f%03d.png")], { encoding: "utf8" });
    if (extracted.status !== 0) {
      throw new Error(`ffmpeg failed to read ${gifPath}`);
    }
    const frames = readdirSync(dir).filter((name) => name.endsWith(".png")).sort();
    let text = "";
    for (const frame of frames) {
      const ocr = spawnSync("tesseract", [join(dir, frame), "stdout", "-l", "eng", "--psm", "6"], { encoding: "utf8" });
      if (ocr.status !== 0) throw new Error(`tesseract failed on ${frame}`);
      text += `\n${ocr.stdout ?? ""}`;
    }
    return { frames: frames.length, text };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

requireScanTools();
const extra = ensureDenylist();
const files: string[] = [];
walk(root, files);
const hits = [];
for (const path of files) {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot) : "";
  if (!allow.has(ext)) continue;
  const text = readFileSync(path, "utf8");
  hits.push(...scanText(relative(root, path), text, extra));
}
let frames = 0;
try {
  const ocr = ocrGif();
  frames = ocr.frames;
  hits.push(...scanText("screenshots/demo.gif", ocr.text, extra));
} catch (error) {
  const message = error instanceof Error ? error.message : "OCR failed";
  process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  process.exit(1);
}
if (hits.length > 0) {
  process.stdout.write(`${JSON.stringify({ ok: false, hits, frames }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, files: files.length, denylist: true, frames }, null, 2)}\n`);
