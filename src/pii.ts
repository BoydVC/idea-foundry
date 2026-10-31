import { Buffer } from "node:buffer";

const BUILTIN = ["a3Bk", "a3BkbGF3Z3JvdXA=", "Y29sbGVjdGlvbnM=", "ZGVidA=="].map((item) =>
  Buffer.from(item, "base64").toString("utf8"),
);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export type PiiHit = { path: string; term: string };

export function builtinTerms(): readonly string[] {
  return BUILTIN;
}

function mentions(text: string, term: string): boolean {
  const needle = term.toLowerCase();
  if (needle.includes(" ")) return text.toLowerCase().includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

export function scanText(path: string, text: string, extra: readonly string[]): PiiHit[] {
  const hits: PiiHit[] = [];
  const terms = [...BUILTIN, ...extra.map((item) => item.trim()).filter((item) => item.length > 0)];
  for (const term of terms) {
    if (mentions(text, term)) hits.push({ path, term });
  }
  if (EMAIL.test(text)) hits.push({ path, term: "email-address" });
  return hits;
}
