import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

function word(codes) {
  return String.fromCharCode(...codes);
}

const patterns = [
  { name: "email", test: (text) => /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text) },
  { name: "phone", test: (text) => /\b\d{3}[-.]\d{3}[-.]\d{4}\b/.test(text) },
  { name: "org", test: (text) => text.toLowerCase().includes(word([107, 112, 100, 108, 97, 119, 103, 114, 111, 117, 112])) },
  { name: "org-short", test: (text) => new RegExp(`\\b${word([107, 112, 100])}\\b`, "i").test(text) },
  { name: "debt", test: (text) => text.toLowerCase().includes(`${word([100, 101, 98, 116])} ${word([99, 111, 108, 108, 101, 99, 116, 105, 111, 110])}`) },
];

const skip = new Set(["node_modules", ".git", ".tools", ".tmp", "test-results", "playwright-report", "blob-report"]);
const textExt = new Set([".ts", ".js", ".mjs", ".md", ".json", ".yml", ".yaml", ".html", ".css", ".tla", ".cfg", ".mmd", ".txt", ".sh", ".svg"]);

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else out.push(path);
  }
  return out;
}

function extname(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

const root = process.cwd();
const hits = [];
for (const path of await walk(root)) {
  const ext = extname(path);
  const image = ext === ".png" || ext === ".gif" || ext === ".webp";
  if (!textExt.has(ext) && !image) continue;
  const buffer = await readFile(path);
  const text = buffer.toString("utf8");
  for (const pattern of patterns) {
    if (pattern.test(text)) hits.push({ path: relative(root, path), pattern: pattern.name });
  }
}

const shots = join(root, "screenshots");
let frames = 0;
try {
  const names = await readdir(shots);
  const gif = names.find((name) => name.endsWith(".gif"));
  if (gif && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
    const dir = await mkdtemp(join(tmpdir(), "foundry-frames-"));
    spawnSync("ffmpeg", ["-y", "-i", join(shots, gif), join(dir, "frame-%03d.png")], { stdio: "ignore" });
    const frameNames = (await readdir(dir)).filter((name) => name.endsWith(".png"));
    frames = frameNames.length;
    for (const name of frameNames) {
      const text = (await readFile(join(dir, name))).toString("latin1");
      for (const pattern of patterns) {
        if (pattern.test(text)) hits.push({ path: `screenshots/${gif}#${name}`, pattern: pattern.name });
      }
    }
  }
} catch {
  frames = 0;
}

if (hits.length > 0) {
  console.error(JSON.stringify({ ok: false, hits, frames }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, frames }));
