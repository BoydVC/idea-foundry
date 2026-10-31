import fs from "node:fs";
import path from "node:path";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\b\d{3}[-.]\d{3}[-.]\d{4}\b/;
const SKIP = new Set([".git", "node_modules", "dist", "data", ".data", ".data-e2e", ".local", "tools", "test-results", "playwright-report", "blob-report"]);

export function builtinDenylist(): string[] {
  return [
    String.fromCharCode(107, 112, 100),
    String.fromCharCode(107, 112, 100, 108, 97, 119, 103, 114, 111, 117, 112),
    String.fromCharCode(99, 111, 108, 108, 101, 99, 116, 105, 111, 110, 115),
  ];
}

export function scanText(file: string, text: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  if (EMAIL.test(text)) {
    hits.push(`${file}: email-like text`);
  }
  if (PHONE.test(text)) {
    hits.push(`${file}: phone-like text`);
  }
  for (const term of terms) {
    const needle = term.trim();
    if (!needle) {
      continue;
    }
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      hits.push(`${file}: denylist term`);
    }
  }
  return hits;
}

export function scanTree(root: string, terms: readonly string[]): string[] {
  const hits: string[] = [];
  walk(root, terms, hits);
  return hits;
}

function walk(dir: string, terms: readonly string[], hits: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, terms, hits);
      continue;
    }
    if (entry.name.endsWith(".jar") || entry.name.endsWith(".webm")) {
      continue;
    }
    const bytes = fs.readFileSync(full);
    const text = bytes.toString("utf8");
    hits.push(...scanText(full, text, terms));
  }
}

export function loadDenylist(file: string | undefined): string[] {
  const terms = builtinDenylist();
  if (file && fs.existsSync(file)) {
    terms.push(...fs.readFileSync(file, "utf8").split(/\r?\n/));
  }
  return terms;
}
