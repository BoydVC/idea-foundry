import fs from "node:fs";

export type TableRow = {
  from: string;
  event: string;
  to: string;
};

export type GuardRow = {
  event: string;
  guard: string;
};

const ROW = /<<"([a-z_]+)", "([a-z_]+)", "([a-z_]+)">>/g;
const GUARD = /^\\\* GUARD ([a-z_]+) ([A-Za-z]+)$/gm;

export function parseTransitionTable(text: string): TableRow[] {
  const start = text.indexOf("TransitionTable ==");
  if (start < 0) {
    throw new Error("model/foundry.tla has no TransitionTable.");
  }
  const end = text.indexOf("\n}", start);
  const slice = text.slice(start, end === -1 ? undefined : end);
  const rows: TableRow[] = [];
  for (const match of slice.matchAll(ROW)) {
    const from = match[1];
    const event = match[2];
    const to = match[3];
    if (!from || !event || !to) {
      continue;
    }
    rows.push({ from, event, to });
  }
  if (rows.length === 0) {
    throw new Error("TransitionTable parsed empty.");
  }
  return rows;
}

export function parseGuards(text: string): GuardRow[] {
  const rows: GuardRow[] = [];
  for (const match of text.matchAll(GUARD)) {
    const event = match[1];
    const guard = match[2];
    if (!event || !guard) {
      continue;
    }
    rows.push({ event, guard });
  }
  return rows;
}

export function readModel(tlaPath: string): { rows: TableRow[]; guards: GuardRow[]; text: string } {
  const text = fs.readFileSync(tlaPath, "utf8");
  return { text, rows: parseTransitionTable(text), guards: parseGuards(text) };
}
