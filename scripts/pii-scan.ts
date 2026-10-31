import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { scanText } from "../src/pii.js";

const root = process.cwd();
const allow = new Set([".ts", ".js", ".mjs", ".css", ".html", ".md", ".json", ".yml", ".yaml", ".mmd", ".tla", ".cfg"]);
const skip = new Set(["node_modules", "dist", "data", "tools", ".git", "test-results", "playwright-report", ".local"]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push(path);
  }
}

const extraPath = process.env.FOUNDRY_DENYLIST ?? join(root, ".local", "pii-denylist.txt");
const extra = existsSync(extraPath)
  ? readFileSync(extraPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  : [];

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
if (hits.length > 0) {
  process.stdout.write(`${JSON.stringify({ ok: false, hits }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, files: files.length, denylist: existsSync(extraPath) })}\n`);
