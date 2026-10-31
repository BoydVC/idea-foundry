import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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

export type Expectation = {
  ideas: { id: IdeaId; version: Version }[];
  specs: { id: SpecId; version: Version }[];
};

export type IntakeLine = {
  idea: string;
  source: "foundry";
  target: string;
  n: 3;
};

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
    const path = this.statePath();
    if (!existsSync(path)) return emptySnapshot();
    return parseSnapshot(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  transact(expect: Expectation, mutate: (snap: Snapshot) => Snapshot, side?: CommitSide): StoreResult<Snapshot> {
    return this.withLock(() => {
      const current = this.load();
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
      this.writeSnapshot(next);
      this.appendLog(current, next);
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

  readIntake(): IntakeLine[] {
    const path = join(this.root, "intake.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as IntakeLine);
  }

  private appendIntake(line: IntakeLine): void {
    appendFileSync(join(this.root, "intake.jsonl"), `${JSON.stringify(line)}\n`);
  }

  writePacket(id: SpecId, body: string): string {
    const dir = join(this.root, "packets");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.json`);
    writeFileSync(path, body);
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

  private writeSnapshot(snap: Snapshot): void {
    mkdirSync(this.root, { recursive: true });
    const path = this.statePath();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(snap, null, 2)}\n`);
    renameSync(tmp, path);
  }

  private appendLog(before: Snapshot, after: Snapshot): void {
    mkdirSync(this.root, { recursive: true });
    for (const idea of after.ideas) {
      const prev = before.ideas.find((item) => item.id === idea.id);
      if (!prev || prev.version !== idea.version) {
        appendFileSync(join(this.root, "ideas.jsonl"), `${JSON.stringify(idea)}\n`);
        appendFileSync(
          join(this.root, "events.jsonl"),
          `${JSON.stringify({ at: idea.updatedAt, id: idea.id, version: idea.version, state: idea.state })}\n`,
        );
      }
    }
    for (const lesson of after.lessons) {
      const prev = before.lessons.find((item) => item.id === lesson.id);
      if (!prev || prev.version !== lesson.version) {
        appendFileSync(join(this.root, "lessons.jsonl"), `${JSON.stringify(lesson)}\n`);
      }
    }
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

  private withLock<T>(body: () => T): T {
    mkdirSync(this.root, { recursive: true });
    const lockPath = join(this.root, "state.lock");
    const started = Date.now();
    for (;;) {
      try {
        const fd = openSync(lockPath, "wx");
        try {
          return body();
        } finally {
          closeSync(fd);
          try {
            unlinkSync(lockPath);
          } catch {
            /* raced */
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > 5000) {
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
