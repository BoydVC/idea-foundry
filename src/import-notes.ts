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

function noteFromRow(row: unknown): { title: string; note: string } {
  if (!row || typeof row !== "object") {
    throw new DomainError("bad_import", "Each note must be an object with a title.", "Use {\"title\",\"note\"} or a markdown heading.");
  }
  const record = row as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : "";
  const note =
    typeof record.note === "string" ? record.note : typeof record.text === "string" ? record.text : typeof record.body === "string" ? record.body : "";
  return { title, note };
}

function fromJson(text: string): { title: string; note: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DomainError("bad_import", "The import file is not valid JSON.", "Fix the JSON, or use markdown headings.");
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? [
          ...((parsed as { notes?: unknown }).notes && Array.isArray((parsed as { notes?: unknown }).notes)
            ? ((parsed as { notes: unknown[] }).notes)
            : []),
          ...((parsed as { bookmarks?: unknown }).bookmarks && Array.isArray((parsed as { bookmarks?: unknown }).bookmarks)
            ? ((parsed as { bookmarks: unknown[] }).bookmarks)
            : []),
        ]
      : null;
  if (!rows) {
    throw new DomainError("bad_import", "JSON import needs a notes or bookmarks list.", "Use {\"bookmarks\":[{\"title\",\"note\"}]}.");
  }
  if (!Array.isArray(parsed) && rows.length === 0 && !("notes" in (parsed as object)) && !("bookmarks" in (parsed as object))) {
    throw new DomainError("bad_import", "JSON import needs a notes or bookmarks list.", "Use {\"bookmarks\":[{\"title\",\"note\"}]}.");
  }
  return rows.map(noteFromRow);
}

function fromMarkdown(text: string): { title: string; note: string }[] {
  if (!/^# /m.test(text)) {
    throw new DomainError("bad_import", "Markdown import needs a # heading for each note.", "Start each note with # and a title.");
  }
  const notes: { title: string; note: string }[] = [];
  for (const chunk of text.split(/^# /m)) {
    if (chunk.trim() === "") continue;
    const [first, ...rest] = chunk.split(/\n/);
    notes.push({ title: (first ?? "").trim(), note: rest.join("\n").trim() });
  }
  return notes;
}

export function parseImportFile(text: string): ImportNote[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const raw = trimmed.startsWith("{") || trimmed.startsWith("[") ? fromJson(trimmed) : fromMarkdown(trimmed);
  return raw.map((item) => ({ title: parseTitle(item.title), note: item.note.trim() }));
}
