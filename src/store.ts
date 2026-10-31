import { open, readFile, writeFile, rename, unlink, mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptySnapshot,
  isIdeaId,
  isSpecId,
  isState,
  type Finding,
  type GateResult,
  type Idea,
  type Lesson,
  type Snapshot,
  type Spec,
  type State,
} from "./domain.ts";
import { FoundryError } from "./errors.ts";
import type { ArenaPacket, InboxLine } from "./packet.ts";

export interface CommitLog {
  action: string;
  id: string;
  state: State;
  ts: string;
}

export interface CommitExtra {
  packet?: ArenaPacket;
}

const REL = /^(ideas\.jsonl|lessons\.jsonl|intake\.jsonl|packets\/s-\d{4}-\d+\.json)$/;

export async function readSnapshot(dir: string): Promise<Snapshot> {
  try {
    const text = await readFile(join(dir, "state.json"), "utf8");
    return parseSnapshot(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySnapshot();
    if (error instanceof FoundryError) throw error;
    throw new FoundryError(
      "state.json is unreadable.",
      500,
      "Remove the data directory or restore state.json, then retry.",
    );
  }
}

export async function commit(
  dir: string,
  expectedVersion: number | undefined,
  dryRun: boolean,
  log: CommitLog,
  build: (snap: Snapshot) => Snapshot,
  extra?: CommitExtra,
): Promise<Snapshot> {
  return withLock(dir, async () => {
    const current = await readSnapshot(dir);
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new FoundryError(
        "The board version is stale.",
        409,
        "Re-read state and retry the command.",
      );
    }
    const next = build(structuredClone(current));
    if (next.version !== current.version + 1) {
      throw new FoundryError(
        "A write must increase the version by 1.",
        500,
        "This is a bug in the writer. Retry from a fresh read.",
      );
    }
    if (dryRun) return next;
    await mkdir(dir, { recursive: true });
    const event = JSON.stringify({ ...log, version: next.version }) + "\n";
    await appendFile(join(dir, "ideas.jsonl"), event);
    const known = new Set(current.lessons.map((lesson) => lesson.id));
    for (const lesson of next.lessons) {
      if (!known.has(lesson.id)) {
        await appendFile(join(dir, "lessons.jsonl"), JSON.stringify(lesson) + "\n");
      }
    }
    if (extra?.packet) {
      const packet: ArenaPacket = {
        ...extra.packet,
        intake: { ...extra.packet.intake, offset: (await intakeCount(dir)) + 1 },
      };
      await writeRel(dir, `packets/${packet.specId}.json`, JSON.stringify(packet, null, 2) + "\n");
      await appendFile(join(dir, "intake.jsonl"), JSON.stringify(inboxFrom(packet)) + "\n");
    }
    await writeRel(dir, "state.json", JSON.stringify(next, null, 2) + "\n");
    return next;
  });
}

export async function readPacket(dir: string, specId: string): Promise<ArenaPacket | null> {
  try {
    const text = await readFile(join(dir, "packets", `${specId}.json`), "utf8");
    return JSON.parse(text) as ArenaPacket;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function intakeCount(dir: string): Promise<number> {
  try {
    const text = await readFile(join(dir, "intake.jsonl"), "utf8");
    return text.split("\n").filter((line) => line.trim().length > 0).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function readIntake(dir: string): Promise<InboxLine[]> {
  try {
    const text = await readFile(join(dir, "intake.jsonl"), "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as InboxLine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeStatechartFile(root: string, body: string): Promise<void> {
  const target = join(root, "statechart.mmd");
  const tmp = `${target}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, target);
}

export async function writeMutationModel(root: string, body: string): Promise<string> {
  const dir = join(root, ".tmp", "tlc");
  await mkdir(dir, { recursive: true });
  const target = join(dir, "foundry_skip_gate.tla");
  await writeFile(target, body);
  return target;
}

function inboxFrom(packet: ArenaPacket): InboxLine {
  return { ...packet.intake };
}

async function writeRel(dir: string, rel: string, body: string): Promise<void> {
  if (!REL.test(rel) && rel !== "state.json") {
    throw new FoundryError("Refusing to write outside the store.", 500, "Write only store files.");
  }
  const target = join(dir, rel);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, target);
}

async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lock = join(dir, "store.lock");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(String(process.pid));
      try {
        return await fn();
      } finally {
        await handle.close();
        await unlink(lock).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await stealDeadLock(lock);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  throw new FoundryError("The store lock is busy.", 409, "Retry the command.");
}

async function stealDeadLock(lock: string): Promise<void> {
  try {
    const pid = Number(await readFile(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) await unlink(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FoundryError("state.json is not JSON.", 500, "Restore state.json and retry.");
  }
  if (!raw || typeof raw !== "object") {
    throw new FoundryError("state.json has no object.", 500, "Restore state.json and retry.");
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.version !== "number" || !Number.isInteger(record.version) || record.version < 0) {
    throw new FoundryError("state.json has a bad version.", 500, "Restore state.json and retry.");
  }
  return {
    version: record.version,
    ideas: arrayOf(record.ideas, parseIdea),
    specs: arrayOf(record.specs, parseSpec),
    lessons: arrayOf(record.lessons, parseLesson),
    findings: arrayOf(record.findings, parseFinding),
  };
}

function arrayOf<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new FoundryError("state.json is missing a list.", 500, "Restore state.json and retry.");
  }
  return value.map(parse);
}

function parseIdea(value: unknown): Idea {
  const item = objectOf(value);
  if (!isIdeaId(item.id) || !isState(item.state) || typeof item.title !== "string") {
    throw new FoundryError("state.json has a bad idea.", 500, "Restore state.json and retry.");
  }
  return {
    id: item.id,
    version: numberOf(item.version),
    state: item.state,
    title: item.title,
    restatement: item.restatement === null ? null : stringOf(item.restatement),
    questions: stringList(item.questions),
    note: item.note === null ? null : stringOf(item.note),
    createdAt: stringOf(item.createdAt),
    updatedAt: stringOf(item.updatedAt),
  };
}

function parseSpec(value: unknown): Spec {
  const item = objectOf(value);
  if (!isSpecId(item.id) || !isIdeaId(item.ideaId) || !isState(item.state) || typeof item.title !== "string") {
    throw new FoundryError("state.json has a bad spec.", 500, "Restore state.json and retry.");
  }
  return {
    id: item.id,
    ideaId: item.ideaId,
    index: numberOf(item.index),
    version: numberOf(item.version),
    state: item.state,
    title: item.title,
    summary: stringOf(item.summary),
    doneWhen: stringOf(item.doneWhen),
    acceptance: stringList(item.acceptance),
    touch: stringList(item.touch),
    maxChangedLines: numberOf(item.maxChangedLines),
    piiClause: stringOf(item.piiClause),
    body: stringOf(item.body),
    gates: arrayOf(item.gates, parseGate),
    prUrl: item.prUrl === null ? null : stringOf(item.prUrl),
    draft: item.draft === null ? null : item.draft === true,
  };
}

function parseGate(value: unknown): GateResult {
  const item = objectOf(value);
  if (item.gate !== "G1" && item.gate !== "G2" && item.gate !== "G3") {
    throw new FoundryError("state.json has a bad gate.", 500, "Restore state.json and retry.");
  }
  const gate: GateResult = {
    gate: item.gate,
    pass: item.pass === true,
    reasons: stringList(item.reasons),
    codes: stringList(item.codes),
  };
  if (typeof item.advisory === "string") gate.advisory = item.advisory;
  return gate;
}

function parseLesson(value: unknown): Lesson {
  const item = objectOf(value);
  if (item.gate !== "G1" && item.gate !== "G2" && item.gate !== "G3") {
    throw new FoundryError("state.json has a bad lesson.", 500, "Restore state.json and retry.");
  }
  return {
    id: stringOf(item.id),
    version: numberOf(item.version),
    code: stringOf(item.code),
    detail: stringOf(item.detail),
    gate: item.gate,
    check: stringOf(item.check),
    count: numberOf(item.count),
    createdAt: stringOf(item.createdAt),
  };
}

function parseFinding(value: unknown): Finding {
  const item = objectOf(value);
  if (!isSpecId(item.specId)) {
    throw new FoundryError("state.json has a bad finding.", 500, "Restore state.json and retry.");
  }
  return {
    code: stringOf(item.code),
    detail: stringOf(item.detail),
    at: stringOf(item.at),
    specId: item.specId,
  };
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new FoundryError("state.json has a bad record.", 500, "Restore state.json and retry.");
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string {
  if (typeof value !== "string") {
    throw new FoundryError("state.json has a bad string.", 500, "Restore state.json and retry.");
  }
  return value;
}

function numberOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new FoundryError("state.json has a bad number.", 500, "Restore state.json and retry.");
  }
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new FoundryError("state.json has a bad list.", 500, "Restore state.json and retry.");
  }
  return value as string[];
}
