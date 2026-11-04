import { DomainError, parseTitle } from "./domain.js";
import type { Restatement } from "./planner.js";

export type ImportNote = {
  title: string;
  note: string;
};

function oneLine(title: string, note: string): string {
  const flat = note.replace(/\s+/g, " ").trim();
  const source = flat.length > 0 ? flat : title;
  const sentence = source.split(/[.!?]/)[0]?.trim() ?? title;
  const line = sentence.length > 0 ? sentence : title;
  return line.length > 140 ? line.slice(0, 140).trimEnd() : line;
}

export function draftOf(title: string, note: string): Restatement {
  const problem = oneLine(title, note);
  return {
    restatement: `Problem: ${problem}. Done when: a command checks "${title}" with synthetic data only.`,
    questions: [
      `Which user action ships first for "${title}"?`,
      "Which existing module must stay unchanged?",
      "Which command shows that this slice is done?",
    ],
  };
}

const MAX_NOTE_CHARS = 4_000;
const MAX_IMPORT_CHARS = 10_000_000;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stringField(record: Record<string, unknown>, keys: readonly string[], label: string): string {
  for (const key of keys) {
    if (!(key in record) || record[key] === undefined) continue;
    const value = record[key];
    if (typeof value !== "string") {
      throw new DomainError("bad_import", `The ${label} field must be a string.`, "Use strings for the title and the note.");
    }
    return value;
  }
  return "";
}

function noteFromRow(row: unknown): { title: string; note: string } {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new DomainError("bad_import", "Each note must be an object with a title.", "Use {\"title\",\"note\"} or a markdown heading.");
  }
  const record = row as Record<string, unknown>;
  const title = stringField(record, ["title", "name"], "title");
  const note = stringField(record, ["note", "text", "body"], "note");
  if (note.length > MAX_NOTE_CHARS) {
    throw new DomainError("bad_import", "A note is too large.", "Keep each note under 4000 characters.");
  }
  return { title, note };
}

function isBareBookmarkExport(rows: unknown[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const record = row as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.text === "string" && !("title" in record);
  });
}

function rejectBareBookmarkExport(rows: unknown[]): void {
  if (!isBareBookmarkExport(rows)) return;
  throw new DomainError(
    "bad_import",
    "This file is an X bookmark export. Use `foundry import --from <file>`.",
    "Run `foundry import --from fixtures/x-bookmarks.json`.",
  );
}

function fromJson(text: string): { title: string; note: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DomainError("bad_import", "The import file is not valid JSON.", "Fix the JSON, or use markdown headings.");
  }
  if (Array.isArray(parsed)) {
    rejectBareBookmarkExport(parsed);
    return parsed.map(noteFromRow);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new DomainError("bad_import", "JSON import needs a notes or bookmarks list.", "Use {\"bookmarks\":[{\"title\",\"note\"}]}.");
  }
  const record = parsed as Record<string, unknown>;
  const notes = listField(record, "notes");
  const bookmarks = listField(record, "bookmarks");
  if (notes === null && bookmarks === null) {
    throw new DomainError("bad_import", "JSON import needs a notes or bookmarks list.", "Use {\"bookmarks\":[{\"title\",\"note\"}]}.");
  }
  if (bookmarks) rejectBareBookmarkExport(bookmarks);
  return [...(notes ?? []), ...(bookmarks ?? [])].map(noteFromRow);
}

function listField(record: Record<string, unknown>, key: "notes" | "bookmarks"): unknown[] | null {
  if (!(key in record)) return null;
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new DomainError("bad_import", `The ${key} field must be a list.`, `Use {"${key}":[{"title","note"}]}.`);
  }
  return value;
}

function fromMarkdown(text: string): { title: string; note: string }[] {
  if (!/^# /m.test(text)) {
    throw new DomainError("bad_import", "Markdown import needs a # heading for each note.", "Start each note with # and a title.");
  }
  const notes: { title: string; note: string }[] = [];
  const chunks = text.split(/^# /m);
  const bodies = /^# /.test(text) ? chunks : chunks.slice(1);
  for (const chunk of bodies) {
    if (chunk.trim() === "") continue;
    const [first, ...rest] = chunk.split(/\n/);
    notes.push({ title: (first ?? "").trim(), note: rest.join("\n").trim() });
  }
  return notes;
}

export type XBookmark = {
  id: string;
  author: string;
  text: string;
  date: string;
};

export type InvalidBookmark = {
  index: number;
  id?: string;
  message: string;
  next: string;
};

function rowProblem(index: number, id: string | undefined, message: string, next: string): InvalidBookmark {
  return { index, id, message: `Row ${index}: ${message}`, next };
}

function bookmarkRow(row: unknown, index: number): { ok: true; value: XBookmark } | { ok: false; error: InvalidBookmark } {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { ok: false, error: rowProblem(index, undefined, "the bookmark must be an object.", "Use {id, author, text, date}.") };
  }
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;
  const text = record.text;
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, error: rowProblem(index, id, "the bookmark needs a text string.", "Add text for that bookmark.") };
  }
  if (text.length > 500) {
    return { ok: false, error: rowProblem(index, id, "the bookmark text is too long.", "Keep the text under 500 characters.") };
  }
  if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(record.id)) {
    return { ok: false, error: rowProblem(index, id, "the bookmark needs an id.", "Use a short id such as bk-habit.") };
  }
  if (typeof record.author !== "string" || record.author.trim() === "" || record.author.length > 80) {
    return { ok: false, error: rowProblem(index, record.id, "the bookmark needs an author string.", "Use a synthetic author label.") };
  }
  if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    return { ok: false, error: rowProblem(index, record.id, "the bookmark needs a YYYY-MM-DD date.", "Use a synthetic date such as 2026-10-20.") };
  }
  return {
    ok: true,
    value: { id: record.id, author: record.author.trim(), text: text.replace(/\s+/g, " ").trim(), date: record.date },
  };
}

export function parseBookmarkExport(text: string): { rows: (XBookmark & { index: number })[]; invalid: InvalidBookmark[] } {
  const trimmed = stripBom(text).trim();
  if (trimmed.length === 0) return { rows: [], invalid: [] };
  if (trimmed.length > MAX_IMPORT_CHARS) {
    throw new DomainError("bad_import", "The import file is too large.", "Split the file and import the pieces.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    throw new DomainError("bad_import", "The bookmark export is not valid JSON.", "Pass a JSON file of {id, author, text, date} rows.");
  }
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { bookmarks?: unknown }).bookmarks)
      ? (payload as { bookmarks: unknown[] }).bookmarks
      : null;
  if (!rows) {
    throw new DomainError("bad_import", "The bookmark export needs a list of {id, author, text, date}.", "Use fixtures/x-bookmarks.json as the shape.");
  }
  const kept: (XBookmark & { index: number })[] = [];
  const invalid: InvalidBookmark[] = [];
  rows.forEach((row, offset) => {
    const result = bookmarkRow(row, offset + 1);
    if (result.ok) kept.push({ ...result.value, index: offset + 1 });
    else invalid.push(result.error);
  });
  return { rows: kept, invalid };
}

export function parseImportFile(text: string): ImportNote[] {
  const trimmed = stripBom(text).trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length > MAX_IMPORT_CHARS) {
    throw new DomainError("bad_import", "The import file is too large.", "Split the file and import the pieces.");
  }
  const raw = trimmed.startsWith("{") || trimmed.startsWith("[") ? jsonOrMarkdown(trimmed) : fromMarkdown(trimmed);
  return raw.map((item) => ({ title: parseTitle(item.title), note: item.note.trim() }));
}

function jsonOrMarkdown(text: string): { title: string; note: string }[] {
  try {
    JSON.parse(text);
  } catch {
    if (/^# /m.test(text)) return fromMarkdown(text);
    throw new DomainError("bad_import", "The import file is not valid JSON.", "Fix the JSON, or use markdown headings.");
  }
  return fromJson(text);
}
