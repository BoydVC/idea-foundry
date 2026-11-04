import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Idea,
  type IdeaId,
  type Lesson,
  type Snapshot,
  type Spec,
  type SpecId,
  type Version,
  DomainError,
  emptySnapshot,
  ideaId,
  parseSnapshot,
  specId,
  version,
} from "./domain.js";

export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export const MAX_IMPORT_BYTES = 10_000_000;

function fsyncDirectory(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function durableWrite(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncDirectory(dirname(path));
}

function quarantine(path: string, fragment: string): void {
  if (fragment.length === 0) return;
  const torn = `${path}.torn`;
  const fd = openSync(torn, "a");
  try {
    writeSync(fd, fragment.endsWith("\n") ? fragment : `${fragment}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDirectory(dirname(path));
}

function repairJsonl(path: string): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  if (raw.length === 0) return [];
  const ended = raw.endsWith("\n");
  const parts = raw.split("\n");
  if (ended) parts.pop();
  const kept: string[] = [];
  const torn: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const line = parts[index] ?? "";
    if (line.length === 0) continue;
    const tail = !ended && index === parts.length - 1;
    try {
      JSON.parse(line);
      kept.push(line);
    } catch {
      torn.push(line);
      if (!tail) torn.push("(unparseable line)");
    }
  }
  if (!ended && parts.length > 0) {
    const last = parts[parts.length - 1] ?? "";
    if (last.length > 0 && !kept.includes(last)) {
      /* already quarantined */
    } else if (last.length > 0 && kept[kept.length - 1] === last) {
      /* complete JSON missing its newline; rewrite will add it */
    }
  }
  const body = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
  const dirty = raw !== body || torn.length > 0;
  if (torn.length > 0) quarantine(path, torn.join("\n"));
  if (dirty) durableWrite(path, body);
  return kept;
}

function lineKey(line: string): string {
  const parsed = JSON.parse(line) as { id?: unknown; version?: unknown };
  return `${String(parsed.id)}|${String(parsed.version)}`;
}

function freshLines(path: string, lines: readonly string[]): string[] {
  const seen = new Set(repairJsonl(path).map((line) => lineKey(line)));
  const out: string[] = [];
  for (const line of lines) {
    const key = lineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function eventLines(snap: Snapshot): string[] {
  const lines: string[] = [];
  for (const idea of snap.ideas) {
    lines.push(JSON.stringify({ at: idea.updatedAt, id: idea.id, version: idea.version, state: idea.state }));
  }
  for (const spec of snap.specs) {
    lines.push(JSON.stringify({ at: spec.updatedAt, id: spec.id, version: spec.version, state: spec.state }));
  }
  return lines;
}

function appendDurable(path: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  repairJsonl(path);
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, `${lines.map((line) => (line.endsWith("\n") ? line.slice(0, -1) : line)).join("\n")}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDirectory(dirname(path));
}

export type Expectation = {
  ideas: { id: IdeaId; version: Version }[];
  specs: { id: SpecId; version: Version }[];
};

export type IntakeLine = {
  ts: string;
  idea: string;
  source: "foundry";
  target: string;
  n: 3;
};

export type QuarantineCounts = {
  events: number;
  ideas: number;
  lessons: number;
  intake: number;
};

export type QuarantineFile = {
  name: string;
  path: string;
  lines: number;
};

const TORN_LOGS = ["events.jsonl.torn", "ideas.jsonl.torn", "lessons.jsonl.torn", "intake.jsonl.torn"] as const;

export function quarantineWarning(counts: QuarantineCounts, files: readonly QuarantineFile[] = []): string | undefined {
  const total = counts.events + counts.ideas + counts.lessons + counts.intake;
  if (total === 0) return undefined;
  const summary = `Quarantined lines: events ${counts.events}, ideas ${counts.ideas}, lessons ${counts.lessons}, intake ${counts.intake}.`;
  const paths = files.filter((file) => file.lines > 0).map((file) => file.path);
  if (paths.length === 0) return summary;
  return `${summary} Torn lines are in ${paths.join(", ")}.`;
}

function intakeKey(line: string): string {
  const row = JSON.parse(line) as IntakeLine;
  return JSON.stringify({ ts: row.ts, idea: row.idea, source: row.source, target: row.target, n: row.n });
}

function isIntake(value: unknown): value is IntakeLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.ts === "string" && typeof row.idea === "string" && row.source === "foundry" && typeof row.target === "string" && row.n === 3;
}

export type CommitSide = {
  packet?: { id: SpecId; body: string };
  intake?: IntakeLine;
};

export type StoreFailure = {
  ok: false;
  status: number;
  error: string;
  message: string;
  next: string;
};

export type StoreSuccess<T> = { ok: true; value: T };

export type StoreResult<T> = StoreSuccess<T> | StoreFailure;

const CONFLICT_NEXT = "Re-read the record and retry with the current version.";

function conflict(expected: number, actual: number): StoreFailure {
  return {
    ok: false,
    status: 409,
    error: "conflict",
    message: `Stale version. Expected ${expected} and found ${actual}.`,
    next: CONFLICT_NEXT,
  };
}

function stable(value: unknown): string {
  return JSON.stringify(order(value));
}

function order(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(order);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = order(source[key]);
    return sorted;
  }
  return value;
}

function comparable(value: object): string {
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.version;
  delete copy.updatedAt;
  return stable(copy);
}

export class Store {
  readonly root: string;
  readonly now: Clock;

  constructor(root: string, now: Clock = systemClock) {
    this.root = root;
    this.now = now;
  }

  reset(): void {
    if (existsSync(this.root)) rmSync(this.root, { recursive: true, force: true });
  }

  load(): Snapshot {
    return this.withLock(() => {
      this.recover();
      return this.readSnapshot();
    });
  }

  readImport(path: string): string {
    let size = 0;
    try {
      size = statSync(path).size;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new DomainError("bad_import", "The import file was not found.", "Check the path and try again.");
      }
      throw error;
    }
    if (size > MAX_IMPORT_BYTES) {
      throw new DomainError(
        "bad_import",
        `The import file is ${size} bytes. The cap is ${MAX_IMPORT_BYTES} bytes and is checked before the file is read.`,
        "Split the file. The cap counts bytes on disk, not UTF-16 characters.",
      );
    }
    return readFileSync(path, "utf8");
  }

  transact(expect: Expectation, mutate: (snap: Snapshot) => Snapshot, side?: CommitSide): StoreResult<Snapshot> {
    return this.withLock(() => {
      this.recover();
      const current = this.readSnapshot();
      for (const item of expect.ideas) {
        const idea = current.ideas.find((candidate) => candidate.id === item.id);
        if (!idea) {
          return {
            ok: false,
            status: 404,
            error: "not_found",
            message: `No idea ${item.id}.`,
            next: "Run `foundry idea \"habit tracker export\"` to create one.",
          };
        }
        if (idea.version !== item.version) return conflict(item.version, idea.version);
      }
      for (const item of expect.specs) {
        const spec = current.specs.find((candidate) => candidate.id === item.id);
        if (!spec) {
          return {
            ok: false,
            status: 404,
            error: "not_found",
            message: `No spec ${item.id}.`,
            next: "Run `foundry decompose <idea-id>` first.",
          };
        }
        if (spec.version !== item.version) return conflict(item.version, spec.version);
      }
      const produced = mutate(current);
      this.assertVersions(current, produced);
      const next = parseSnapshot({ ...produced, version: version(current.version + 1) });
      this.appendLog(current, next);
      this.writeSnapshot(next);
      if (side?.packet) {
        const written = next.specs.find((spec) => spec.id === side.packet?.id);
        if (written?.state === "dispatched") {
          this.writePacket(side.packet.id, side.packet.body);
          if (side.intake) this.appendIntake(side.intake);
        }
      }
      return { ok: true, value: next };
    });
  }

  findIdea(id: string): Idea | undefined {
    let parsed: IdeaId;
    try {
      parsed = ideaId(id);
    } catch {
      return undefined;
    }
    return this.load().ideas.find((idea) => idea.id === parsed);
  }

  findSpec(id: string): Spec | undefined {
    let parsed: SpecId;
    try {
      parsed = specId(id);
    } catch {
      return undefined;
    }
    return this.load().specs.find((spec) => spec.id === parsed);
  }

  readText(path: string): string {
    return readFileSync(path, "utf8");
  }

  writeAttempt(id: string, report: string, pr: string | undefined): void {
    if (!/^s-\d{4,}-[1-6]$/.test(id)) {
      throw new DomainError("bad_spec_id", `Bad spec id ${JSON.stringify(id)}.`, "Use an id like s-0001-1.");
    }
    this.withLock(() => {
      const dir = join(this.root, "attempts");
      mkdirSync(dir, { recursive: true });
      durableWrite(join(dir, `${id}.json`), `${JSON.stringify({ report, pr: pr ?? null })}\n`);
    });
  }

  readAttempt(id: string): { report: string; pr?: string } | undefined {
    const path = join(this.root, "attempts", `${id}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { report?: unknown; pr?: unknown };
      if (typeof parsed.report !== "string" || parsed.report.length === 0) return undefined;
      return { report: parsed.report, pr: typeof parsed.pr === "string" ? parsed.pr : undefined };
    } catch {
      return undefined;
    }
  }

  readStatic(name: string): string {
    if (!/^[a-z0-9.-]+$/.test(name)) {
      throw new DomainError("bad_static", "Static name rejected.", "Ask for index.html, app.js, or app.css.");
    }
    return readFileSync(join(this.publicDir(), name), "utf8");
  }

  readModel(name: string): string {
    if (!/^[a-z0-9.-]+$/.test(name)) {
      throw new DomainError("bad_model", "Model name rejected.", "Ask for a file in model/.");
    }
    return readFileSync(join(this.modelDir(), name), "utf8");
  }

  writeProposal(name: string, body: string): { path: string; idempotent: boolean } {
    if (!/^[a-z0-9.-]+$/.test(name)) {
      throw new DomainError("bad_proposal", "Proposal name rejected.", "Use a short file name for the lesson proposal.");
    }
    return this.withLock(() => {
      const dir = join(this.root, "lessons", "proposals");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, "utf8") === body) return { path, idempotent: true };
      writeFileSync(path, body);
      return { path, idempotent: false };
    });
  }

  readIntake(): IntakeLine[] {
    return this.withLock(() => {
      this.recover();
      return repairJsonl(join(this.root, "intake.jsonl")).map((line) => JSON.parse(line) as IntakeLine);
    });
  }

  quarantineFiles(): QuarantineFile[] {
    return TORN_LOGS.map((name) => {
      const path = resolve(this.root, name);
      if (!existsSync(path)) return { name, path, lines: 0 };
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0).length;
      return { name, path, lines };
    });
  }

  quarantineCounts(): QuarantineCounts {
    const files = this.quarantineFiles();
    const lines = (prefix: string) => files.find((file) => file.name.startsWith(prefix))?.lines ?? 0;
    return { events: lines("events"), ideas: lines("ideas"), lessons: lines("lessons"), intake: lines("intake") };
  }

  archiveQuarantine(): { name: string; from: string; to: string; lines: number }[] {
    return this.withLock(() => {
      const moved: { name: string; from: string; to: string; lines: number }[] = [];
      for (const file of this.quarantineFiles()) {
        if (file.lines === 0 || !existsSync(file.path)) continue;
        const body = readFileSync(file.path, "utf8");
        const chunk = body.endsWith("\n") ? body : `${body}\n`;
        const archive = `${file.path}.archive`;
        const prior = existsSync(archive) ? readFileSync(archive, "utf8") : "";
        const next = prior.length === 0 ? chunk : `${prior.endsWith("\n") ? prior : `${prior}\n`}${chunk}`;
        durableWrite(archive, next);
        unlinkSync(file.path);
        moved.push({ name: file.name, from: file.path, to: archive, lines: file.lines });
      }
      return moved;
    });
  }

  private appendIntake(line: IntakeLine): void {
    appendDurable(join(this.root, "intake.jsonl"), [JSON.stringify(line)]);
  }

  writePacket(id: SpecId, body: string): string {
    const dir = join(this.root, "packets");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.json`);
    durableWrite(path, body);
    return path;
  }

  writeReport(id: SpecId, body: string): string {
    const dir = join(this.root, "reports");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.md`);
    writeFileSync(path, body);
    return path;
  }

  private assertVersions(before: Snapshot, after: Snapshot): void {
    this.assertGroup(before.ideas, after.ideas, "idea");
    this.assertGroup(before.specs, after.specs, "spec");
    this.assertGroup(before.stacks, after.stacks, "stack");
    this.assertGroup(before.lessons, after.lessons, "lesson");
  }

  private assertGroup<T extends { id: string; version: number }>(before: readonly T[], after: readonly T[], label: string): void {
    if (after.length < before.length) {
      throw new DomainError("dropped_record", `A ${label} disappeared during a write.`, "Do not delete records.");
    }
    for (const next of after) {
      const prev = before.find((item) => item.id === next.id);
      if (!prev) {
        if (next.version !== 1) {
          throw new DomainError("bad_version", `New ${label} ${next.id} must start at version 1.`, "Create the record at version 1.");
        }
        continue;
      }
      const same = comparable(prev) === comparable(next);
      if (same && next.version !== prev.version) {
        throw new DomainError("bad_version", `${label} ${next.id} changed version without a change.`, "Keep the version when the record is unchanged.");
      }
      if (!same && next.version !== prev.version + 1) {
        throw new DomainError(
          "bad_version",
          `${label} ${next.id} must increment its version by 1.`,
          "Bump the version exactly once per change.",
        );
      }
    }
  }

  private readSnapshot(): Snapshot {
    const path = this.statePath();
    if (!existsSync(path)) return emptySnapshot();
    return parseSnapshot(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  private recover(): void {
    mkdirSync(this.root, { recursive: true });
    repairJsonl(join(this.root, "events.jsonl"));
    repairJsonl(join(this.root, "ideas.jsonl"));
    repairJsonl(join(this.root, "lessons.jsonl"));
    const snap = this.readSnapshot();
    this.reconcile(join(this.root, "events.jsonl"), eventLines(snap));
    this.reconcile(join(this.root, "ideas.jsonl"), snap.ideas.map((idea) => JSON.stringify(idea)));
    this.reconcile(join(this.root, "lessons.jsonl"), snap.lessons.map((lesson) => JSON.stringify(lesson)));
    this.reconcileIntake(snap);
  }

  private reconcileIntake(snap: Snapshot): void {
    const path = join(this.root, "intake.jsonl");
    const kept = repairJsonl(path);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const line of kept) {
      let key: string;
      try {
        key = intakeKey(line);
      } catch {
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(line);
    }
    const missing: string[] = [];
    for (const spec of snap.specs) {
      if (spec.state !== "dispatched" && spec.state !== "verified") continue;
      const packetPath = join(this.root, "packets", `${spec.id}.json`);
      if (!existsSync(packetPath)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(packetPath, "utf8"));
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      const intake = (parsed as { intake?: unknown }).intake;
      if (!isIntake(intake)) continue;
      const line = JSON.stringify({ ts: intake.ts, idea: intake.idea, source: intake.source, target: intake.target, n: intake.n });
      const key = intakeKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push(line);
      unique.push(line);
    }
    if (missing.length === 0 && unique.length === kept.length) return;
    durableWrite(path, unique.length === 0 ? "" : `${unique.join("\n")}\n`);
  }

  private reconcile(path: string, wanted: readonly string[]): void {
    const kept = repairJsonl(path);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const line of kept) {
      const parsed = JSON.parse(line) as { id?: unknown; version?: unknown };
      const key = `${String(parsed.id)}|${String(parsed.version)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(line);
    }
    const missing: string[] = [];
    for (const line of wanted) {
      const parsed = JSON.parse(line) as { id?: unknown; version?: unknown };
      const key = `${String(parsed.id)}|${String(parsed.version)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push(line);
      unique.push(line);
    }
    if (missing.length === 0 && unique.length === kept.length) return;
    durableWrite(path, unique.length === 0 ? "" : `${unique.join("\n")}\n`);
  }

  private writeSnapshot(snap: Snapshot): void {
    durableWrite(this.statePath(), `${JSON.stringify(snap, null, 2)}\n`);
  }

  private appendLog(before: Snapshot, after: Snapshot): void {
    const ideaLines: string[] = [];
    const eventLinesOut: string[] = [];
    const lessonLines: string[] = [];
    for (const idea of after.ideas) {
      const prev = before.ideas.find((item) => item.id === idea.id);
      if (!prev || prev.version !== idea.version) {
        ideaLines.push(JSON.stringify(idea));
        eventLinesOut.push(JSON.stringify({ at: idea.updatedAt, id: idea.id, version: idea.version, state: idea.state }));
      }
    }
    for (const spec of after.specs) {
      const prev = before.specs.find((item) => item.id === spec.id);
      if (!prev || prev.version !== spec.version) {
        eventLinesOut.push(JSON.stringify({ at: spec.updatedAt, id: spec.id, version: spec.version, state: spec.state }));
      }
    }
    for (const lesson of after.lessons) {
      const prev = before.lessons.find((item) => item.id === lesson.id);
      if (!prev || prev.version !== lesson.version) lessonLines.push(JSON.stringify(lesson));
    }
    appendDurable(join(this.root, "ideas.jsonl"), freshLines(join(this.root, "ideas.jsonl"), ideaLines));
    appendDurable(join(this.root, "events.jsonl"), freshLines(join(this.root, "events.jsonl"), eventLinesOut));
    appendDurable(join(this.root, "lessons.jsonl"), freshLines(join(this.root, "lessons.jsonl"), lessonLines));
  }

  private statePath(): string {
    return join(this.root, "state.json");
  }

  private publicDir(): string {
    return join(dirname(fileURLToPath(import.meta.url)), "../public");
  }

  private modelDir(): string {
    return join(dirname(fileURLToPath(import.meta.url)), "../model");
  }

  private releaseLock(lockPath: string, token: string): void {
    try {
      if (readFileSync(lockPath, "utf8") !== token) return;
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  }

  private lockIsLive(lockPath: string): boolean {
    let text: string;
    try {
      text = readFileSync(lockPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      throw error;
    }
    const pid = Number(text.split(" ")[0]);
    if (!Number.isInteger(pid) || pid <= 0) {
      try {
        return Date.now() - statSync(lockPath).mtimeMs < 5000;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return false;
        throw error;
      }
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "EPERM";
    }
  }

  private withLock<T>(body: () => T): T {
    mkdirSync(this.root, { recursive: true });
    const lockPath = join(this.root, "state.lock");
    const token = `${process.pid} ${Date.now()} ${Math.random()}`;
    const started = Date.now();
    for (;;) {
      try {
        const fd = openSync(lockPath, "wx");
        try {
          writeSync(fd, token);
          return body();
        } finally {
          closeSync(fd);
          this.releaseLock(lockPath, token);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        if (!this.lockIsLive(lockPath)) {
          try {
            unlinkSync(lockPath);
          } catch {
            /* raced */
          }
          continue;
        }
        if (Date.now() - started > 8000) {
          throw new DomainError("lock_timeout", "Timed out waiting for state.json.", "Retry the command.");
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      }
    }
  }
}
