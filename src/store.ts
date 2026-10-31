import fs from "node:fs";
import path from "node:path";
import {
  CasConflict,
  CommandError,
  emptySnapshot,
  type Finding,
  type GateResult,
  type Idea,
  type IdeaId,
  type Lesson,
  type Packet,
  type Snapshot,
  type Spec,
  type SpecId,
  type State,
  STATES,
} from "./domain.ts";

export type JournalEntry = {
  stream: "ideas" | "events" | "lessons";
  record: unknown;
};

export type Store = {
  dir: string;
  read(): Snapshot;
  update<T>(
    expected: number,
    change: (draft: Snapshot) => { result: T; journal?: JournalEntry[] },
  ): T;
};

const sleepPad = new Int32Array(new SharedArrayBuffer(4));

export function openStore(dir: string): Store {
  fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, "state.json");
  const streams = {
    ideas: path.join(dir, "ideas.jsonl"),
    events: path.join(dir, "events.jsonl"),
    lessons: path.join(dir, "lessons.jsonl"),
  } as const;
  if (!fs.existsSync(statePath)) {
    fs.writeFileSync(statePath, JSON.stringify(emptySnapshot(), null, 2));
  }
  for (const file of Object.values(streams)) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "");
    }
  }

  function read(): Snapshot {
    return parseSnapshot(fs.readFileSync(statePath, "utf8"));
  }

  function update<T>(
    expected: number,
    change: (draft: Snapshot) => { result: T; journal?: JournalEntry[] },
  ): T {
    const lock = path.join(dir, "state.lock");
    acquire(lock);
    try {
      const current = read();
      if (current.version !== expected) {
        throw new CasConflict(expected, current.version);
      }
      const draft = structuredClone(current);
      const outcome = change(draft);
      if (draft.version !== expected) {
        throw new CommandError(
          "A writer tried to assign the snapshot version.",
          "Leave version to the store. Retry the command.",
        );
      }
      draft.version = expected + 1;
      const tmp = path.join(dir, `state.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`);
      const again = read();
      if (again.version !== expected) {
        fs.rmSync(tmp, { force: true });
        throw new CasConflict(expected, again.version);
      }
      fs.renameSync(tmp, statePath);
      const journal = outcome.journal ?? [];
      journal.push({
        stream: "events",
        record: { version: draft.version, at: new Date().toISOString() },
      });
      for (const entry of journal) {
        fs.appendFileSync(streams[entry.stream], `${JSON.stringify(entry.record)}\n`);
      }
      return outcome.result;
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }

  return { dir, read, update };
}

function acquire(lock: string): void {
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        age = 0;
      }
      if (age > 5000) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() - started > 2000) {
        throw new CommandError(
          "State lock is held by another writer.",
          "Wait a moment and retry the command.",
          409,
        );
      }
      Atomics.wait(sleepPad, 0, 0, 15);
    }
  }
}

function parseSnapshot(raw: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CommandError("state.json is not JSON.", "Restore state.json from a clean snapshot and retry.");
  }
  if (!value || typeof value !== "object") {
    throw new CommandError("state.json is not an object.", "Restore state.json and retry.");
  }
  const row = value as Record<string, unknown>;
  const version = numberField(row, "version");
  const nextIdea = numberField(row, "nextIdea");
  return {
    version,
    nextIdea,
    ideas: arrayField(row, "ideas").map(parseIdea),
    specs: arrayField(row, "specs").map(parseSpec),
    gates: arrayField(row, "gates").map(parseGate),
    lessons: arrayField(row, "lessons").map(parseLesson),
    findings: arrayField(row, "findings").map(parseFinding),
    bannedPhrases: arrayField(row, "bannedPhrases").map(requireString),
    packets: arrayField(row, "packets").map(parsePacket),
    tlc: parseTlc(row.tlc),
  };
}

function parseIdea(value: unknown): Idea {
  const row = objectField(value, "idea");
  const questions = row.questions;
  return {
    kind: "idea",
    id: ideaId(requireString(row.id)),
    version: numberField(row, "version"),
    state: stateField(row.state),
    title: requireString(row.title),
    restatement: stringOrNull(row.restatement),
    questions: parseQuestions(questions),
    note: stringOrNull(row.note),
    createdAt: requireString(row.createdAt),
  };
}

function parseQuestions(value: unknown): [string, string, string] | null {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 3) {
    throw new CommandError("Idea questions must be three strings.", "Re-run foundry restate <id>.");
  }
  const first = value[0];
  const second = value[1];
  const third = value[2];
  if (typeof first !== "string" || typeof second !== "string" || typeof third !== "string") {
    throw new CommandError("Idea questions must be three strings.", "Re-run foundry restate <id>.");
  }
  return [first, second, third];
}

function parseSpec(value: unknown): Spec {
  const row = objectField(value, "spec");
  return {
    kind: "spec",
    id: specId(requireString(row.id)),
    ideaId: ideaId(requireString(row.ideaId)),
    version: numberField(row, "version"),
    state: stateField(row.state),
    order: numberField(row, "order"),
    title: requireString(row.title),
    doneWhen: requireString(row.doneWhen),
    body: requireString(row.body),
    acceptance: arrayField(row, "acceptance").map(parseCheck),
    touchMap: arrayField(row, "touchMap").map(requireString),
    maxChangedLines: numberField(row, "maxChangedLines"),
    piiClause: requireString(row.piiClause),
    draftPr: boolOrNull(row.draftPr),
    prUrl: stringOrNull(row.prUrl),
    reportExcerpt: stringOrNull(row.reportExcerpt),
  };
}

function parseCheck(value: unknown): { command: string; description: string } {
  const row = objectField(value, "acceptance");
  return {
    command: requireString(row.command),
    description: requireString(row.description),
  };
}

function parseGate(value: unknown): GateResult {
  const row = objectField(value, "gate");
  const gate = requireString(row.gate);
  if (gate !== "G1" && gate !== "G2" && gate !== "G3") {
    throw new CommandError(`Unknown gate ${gate}.`, "Keep gates at G1, G2, or G3.");
  }
  return {
    specId: specId(requireString(row.specId)),
    gate,
    pass: requireBoolean(row.pass),
    reasons: arrayField(row, "reasons").map(requireString),
    at: requireString(row.at),
  };
}

function parseLesson(value: unknown): Lesson {
  const row = objectField(value, "lesson");
  return {
    id: requireString(row.id),
    finding: requireString(row.finding),
    count: numberField(row, "count"),
    encodedAs: "G2",
    at: requireString(row.at),
  };
}

function parseFinding(value: unknown): Finding {
  const row = objectField(value, "finding");
  return { text: requireString(row.text), count: numberField(row, "count") };
}

function parsePacket(value: unknown): Packet {
  const row = objectField(value, "packet");
  const depends = row.dependsOn;
  return {
    protocol: "dd.intake/v1",
    op: "intake",
    id: specId(requireString(row.id)),
    ideaId: ideaId(requireString(row.ideaId)),
    title: requireString(row.title),
    order: numberField(row, "order"),
    dependsOn: depends === null ? null : specId(requireString(depends)),
    stack: arrayField(row, "stack").map((item) => specId(requireString(item))),
    specMarkdown: requireString(row.specMarkdown),
    acceptance: arrayField(row, "acceptance").map(parseCheck),
    touchMap: arrayField(row, "touchMap").map(requireString),
    maxChangedLines: numberField(row, "maxChangedLines"),
    piiClause: requireString(row.piiClause),
    doneWhen: requireString(row.doneWhen),
    constraints: { draftOnly: true, noMerge: true, noDeploy: true },
  };
}

function parseTlc(value: unknown): Snapshot["tlc"] {
  if (value === null || value === undefined) {
    return null;
  }
  const row = objectField(value, "tlc");
  return {
    ok: requireBoolean(row.ok),
    detail: requireString(row.detail),
    at: requireString(row.at),
  };
}

function objectField(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandError(`state.json has a bad ${label}.`, "Restore state.json and retry.");
  }
  return value as Record<string, unknown>;
}

function arrayField(row: Record<string, unknown>, key: string): unknown[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    throw new CommandError(`state.json field ${key} is not a list.`, "Restore state.json and retry.");
  }
  return value;
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CommandError(`state.json field ${key} is not an integer.`, "Restore state.json and retry.");
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new CommandError("state.json has a non-string where a string is required.", "Restore state.json and retry.");
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new CommandError("state.json has a non-boolean where a boolean is required.", "Restore state.json and retry.");
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value);
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null) {
    return null;
  }
  return requireBoolean(value);
}

function stateField(value: unknown): State {
  if (typeof value !== "string" || !STATES.includes(value as State)) {
    throw new CommandError(`Unknown state ${String(value)}.`, "Use a state from the foundry model.");
  }
  return value as State;
}

export function ideaId(value: string): IdeaId {
  if (!/^i-\d{4}$/.test(value)) {
    throw new CommandError(`Idea id ${value} is not shaped like i-0001.`, "Use an id from foundry list.");
  }
  return value as IdeaId;
}

export function specId(value: string): SpecId {
  if (!/^s-\d{4}-\d+$/.test(value)) {
    throw new CommandError(
      `Spec id ${value} is not shaped like s-0001-1.`,
      "Use an id from foundry show <idea-id>.",
    );
  }
  return value as SpecId;
}
