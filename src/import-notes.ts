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

function fromJson(text: string): { title: string; note: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DomainError("bad_import", "The import file is not valid JSON.", "Fix the JSON, or use markdown headings.");
  }
  if (Array.isArray(parsed)) return parsed.map(noteFromRow);
  if (!parsed || typeof parsed !== "object") {
    throw new DomainError("bad_import", "JSON import needs a notes or bookmarks list.", "Use {\"bookmarks\":[{\"title\",\"note\"}]}.");
  }
  const record = parsed as Record<string, unknown>;
  const notes = listField(record, "notes");
  const bookmarks = listField(record, "bookmarks");
  if (notes === null && bookmarks === null) {
    throw new DomainError("bad_import", "JSON import needs a notes or bookmarks list.", "Use {\"bookmarks\":[{\"title\",\"note\"}]}.");
  }
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

function bookmarkRow(row: unknown): XBookmark {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new DomainError("bad_import", "Each bookmark must be an object.", "Use {id, author, text, date}.");
  }
  const record = row as Record<string, unknown>;
  const id = record.id;
  const author = record.author;
  const text = record.text;
  const date = record.date;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    throw new DomainError("bad_import", "Each bookmark needs an id.", "Use a short id such as bk-habit.");
  }
  if (typeof author !== "string" || author.trim() === "" || author.length > 80) {
    throw new DomainError("bad_import", "Each bookmark needs an author string.", "Use a synthetic author label.");
  }
  if (typeof text !== "string" || text.trim() === "" || text.length > 500) {
    throw new DomainError("bad_import", "Each bookmark needs a text string.", "Keep the text under 500 characters.");
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new DomainError("bad_import", "Each bookmark needs a YYYY-MM-DD date.", "Use a synthetic date such as 2026-10-20.");
  }
  return { id, author: author.trim(), text: text.replace(/\s+/g, " ").trim(), date };
}

export function parseBookmarkExport(text: string): XBookmark[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length > 256_000) {
    throw new DomainError("bad_import", "The import file is too large.", "Split the file and import the pieces.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new DomainError("bad_import", "The bookmark export is not valid JSON.", "Pass a JSON file of {id, author, text, date} rows.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { bookmarks?: unknown }).bookmarks)
      ? (parsed as { bookmarks: unknown[] }).bookmarks
      : null;
  if (!rows) {
    throw new DomainError("bad_import", "The bookmark export needs a list of {id, author, text, date}.", "Use fixtures/x-bookmarks.json as the shape.");
  }
  return rows.map(bookmarkRow);
}

export function parseImportFile(text: string): ImportNote[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length > 256_000) {
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
