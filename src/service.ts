import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ideaId,
  ideaNumber,
  specId,
  transition,
  type EventType,
  type Finding,
  type Idea,
  type IdeaId,
  type Lesson,
  type Snapshot,
  type Spec,
  type SpecId,
  type State,
} from "./domain.ts";
import { fail, FoundryError, type Fail } from "./errors.ts";
import { LESSON_CHECKS, lintSpec, nextAfterGate, verifyBlocked } from "./gates.ts";
import { buildPacket, parseTarget, type ArenaPacket } from "./packet.ts";
import { FixturePlanner, SEED_TITLES, type Planner } from "./planner.ts";
import { parsePrUrl, parseReport } from "./report.ts";
import { packageRoot } from "./root.ts";
import { personalDataHit } from "./safety.ts";
import { chartDocument } from "./statechart.ts";
import { commit, intakeCount, readPacket, readSnapshot } from "./store.ts";

export interface PublicSnapshot {
  version: number;
  ideas: Idea[];
  specs: Spec[];
  lessons: Lesson[];
}

export interface Pass {
  ok: true;
  noop: boolean;
  dryRun: boolean;
  snapshot: PublicSnapshot;
  ideaId?: IdeaId;
  specId?: SpecId;
  packet?: ArenaPacket;
}

export type Result = Pass | Fail;

export interface CallOpts {
  dryRun?: boolean;
  expectedVersion?: number;
  recordVersion?: number;
}

export interface FoundryOptions {
  now?: () => string;
  planner?: Planner;
  reviewUrl?: string;
  target?: string;
}

const PAST_GATE: ReadonlySet<State> = new Set(["gated", "dispatched", "verified", "rejected"]);
const LANDED: ReadonlySet<State> = new Set(["dispatched", "verified", "rejected"]);

export function publish(snap: Snapshot): PublicSnapshot {
  return { version: snap.version, ideas: snap.ideas, specs: snap.specs, lessons: snap.lessons };
}

export function syncIdeaState(idea: Idea, specs: readonly Spec[]): Idea {
  const mine = specs.filter((spec) => spec.ideaId === idea.id);
  if (mine.length === 0) return idea;
  let state = idea.state;
  const apply = (type: EventType) => {
    const moved = transition(state, { type });
    if (moved.ok) state = moved.state;
  };
  if (state === "gated" && mine.some((spec) => spec.state === "specced")) apply("gate_fail");
  if (state === "specced" && mine.every((spec) => PAST_GATE.has(spec.state))) apply("gate_pass");
  if (state === "gated" && mine.every((spec) => LANDED.has(spec.state))) apply("dispatch");
  if (state === "dispatched" && mine.every((spec) => spec.state === "verified")) apply("verify_draft");
  if (
    state === "dispatched" &&
    mine.some((spec) => spec.state === "rejected") &&
    mine.every((spec) => spec.state === "verified" || spec.state === "rejected")
  ) {
    apply("reject_draft");
  }
  return state === idea.state ? idea : { ...idea, state };
}

export function createFoundry(dataDir: string, options: FoundryOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const planner = options.planner ?? new FixturePlanner();
  const reviewUrl = options.reviewUrl;
  const defaultTarget = options.target ?? "BoydVC/idea-foundry";

  async function guard(run: () => Promise<Pass>): Promise<Result> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof FoundryError) return fail(error);
      throw error;
    }
  }

  function pass(snap: Snapshot, extra: Partial<Pass> = {}, dryRun = false, noop = false): Pass {
    return { ok: true, noop, dryRun, snapshot: publish(snap), ...extra };
  }

  function assertVersion(recordVersion: number | undefined, actual: number): void {
    if (recordVersion !== undefined && recordVersion !== actual) {
      throw new FoundryError("The record version is stale.", 409, "Re-read state and retry the command.");
    }
  }

  function cleanText(value: string, label: string, max: number): string {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed.length < 1 || trimmed.length > max) {
      throw new FoundryError(
        `The ${label} needs 1 to ${max} characters.`,
        400,
        label === "title" ? "Pass a short idea title." : "Pass --note with the decision.",
      );
    }
    const hit = personalDataHit(trimmed);
    if (hit) {
      throw new FoundryError(
        `The ${label} contains ${hit}.`,
        400,
        "Use generic sample text such as habit tracker export.",
      );
    }
    return trimmed;
  }

  async function save(
    opts: CallOpts | undefined,
    action: string,
    id: string,
    state: State,
    build: (snap: Snapshot) => Snapshot,
    extra?: { packet?: ArenaPacket },
  ): Promise<Snapshot> {
    return commit(
      dataDir,
      opts?.expectedVersion,
      opts?.dryRun === true,
      { action, id, state, ts: now() },
      build,
      extra,
    );
  }

  function ideaById(snap: Snapshot, id: string): Idea {
    const idea = snap.ideas.find((item) => item.id === id);
    if (!idea) throw new FoundryError(`Unknown id ${id}.`, 404, "Run foundry list.");
    return idea;
  }

  function specById(snap: Snapshot, id: string): Spec {
    const spec = snap.specs.find((item) => item.id === id);
    if (!spec) throw new FoundryError(`Unknown id ${id}.`, 404, "Run foundry list.");
    return spec;
  }

  const methods = {
    async idea(title: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const clean = cleanText(title, "title", 120);
        const snap = await save(opts, "idea", "new", "raw", (current) => {
          const next = ideaId(current.ideas.reduce((max, item) => Math.max(max, ideaNumber(item.id)), 0) + 1);
          const stamp = now();
          const idea: Idea = {
            id: next,
            version: current.version + 1,
            state: "raw",
            title: clean,
            restatement: null,
            questions: [],
            note: null,
            createdAt: stamp,
            updatedAt: stamp,
          };
          return { ...current, version: current.version + 1, ideas: [...current.ideas, idea] };
        });
        const created = snap.ideas.at(-1);
        return pass(snap, created ? { ideaId: created.id } : {}, opts?.dryRun === true);
      });
    },

    async restate(id: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const current = await readSnapshot(dataDir);
        const idea = ideaById(current, id);
        if (idea.restatement && idea.state !== "raw") {
          return pass(current, { ideaId: idea.id }, false, true);
        }
        const copy = planner.restate(idea.title);
        const snap = await save(opts, "restate", id, "restated", (latest) => {
          const found = ideaById(latest, id);
          assertVersion(opts?.recordVersion, found.version);
          const moved = transition(found.state, { type: "restate" });
          if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
          const ideas = latest.ideas.map((item) =>
            item.id === found.id
              ? {
                  ...item,
                  state: moved.state,
                  restatement: copy.restatement,
                  questions: [...copy.questions],
                  version: latest.version + 1,
                  updatedAt: now(),
                }
              : item,
          );
          return { ...latest, version: latest.version + 1, ideas };
        });
        return pass(snap, { ideaId: idea.id }, opts?.dryRun === true);
      });
    },

    async approve(id: string, note: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const clean = cleanText(note, "note", 240);
        const current = await readSnapshot(dataDir);
        const idea = ideaById(current, id);
        if (idea.note && idea.state !== "raw" && idea.state !== "restated") {
          return pass(current, { ideaId: idea.id }, false, true);
        }
        const snap = await save(opts, "approve", id, "approved", (latest) => {
          const found = ideaById(latest, id);
          assertVersion(opts?.recordVersion, found.version);
          const moved = transition(found.state, { type: "approve" });
          if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
          const ideas = latest.ideas.map((item) =>
            item.id === found.id
              ? { ...item, state: moved.state, note: clean, version: latest.version + 1, updatedAt: now() }
              : item,
          );
          return { ...latest, version: latest.version + 1, ideas };
        });
        return pass(snap, { ideaId: idea.id }, opts?.dryRun === true);
      });
    },

    async decompose(id: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const current = await readSnapshot(dataDir);
        const idea = ideaById(current, id);
        const existing = current.specs.filter((spec) => spec.ideaId === idea.id);
        if (existing.length > 0) return pass(current, { ideaId: idea.id }, false, true);
        const drafts = planner.decompose(idea.title, idea.restatement ?? idea.title);
        if (drafts.length < 2 || drafts.length > 6) {
          throw new FoundryError("Decompose must produce 2 to 6 specs.", 500, "Adjust the planner and retry.");
        }
        const snap = await save(opts, "decompose", id, "specced", (latest) => {
          const found = ideaById(latest, id);
          assertVersion(opts?.recordVersion, found.version);
          const moved = transition(found.state, { type: "decompose" });
          if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
          const version = latest.version + 1;
          const specs = drafts.map((draft) => {
            const spec: Spec = {
              id: specId(found.id, draft.index),
              ideaId: found.id,
              index: draft.index,
              version,
              state: "specced",
              title: draft.title,
              summary: draft.summary,
              doneWhen: draft.doneWhen,
              acceptance: draft.acceptance,
              touch: draft.touch,
              maxChangedLines: draft.maxChangedLines,
              piiClause: draft.piiClause,
              body: draft.body,
              gates: [],
              prUrl: null,
              draft: null,
            };
            return spec;
          });
          const ideas = latest.ideas.map((item) =>
            item.id === found.id ? { ...item, state: moved.state, version, updatedAt: now() } : item,
          );
          return { ...latest, version, ideas, specs: [...latest.specs, ...specs] };
        });
        return pass(snap, { ideaId: idea.id }, opts?.dryRun === true);
      });
    },

    async gate(id: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const current = await readSnapshot(dataDir);
        const idea = resolveIdea(current, id);
        if (idea.state !== "specced" && idea.state !== "gated") {
          const moved = transition(idea.state, { type: "gate_pass" });
          if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
        }
        const mine = current.specs.filter((spec) => spec.ideaId === idea.id);
        const advisories = new Map<string, string>();
        for (const spec of mine) {
          if (spec.state === "specced" || spec.state === "gated") {
            advisories.set(spec.id, await g2Advisory(spec.body, reviewUrl));
          }
        }
        const snap = await save(opts, "gate", idea.id, idea.state, (latest) => {
          const found = ideaById(latest, idea.id);
          assertVersion(opts?.recordVersion, found.version);
          let specs = latest.specs.map((spec) => ({ ...spec, gates: spec.gates.map((gate) => ({ ...gate })) }));
          let findings: Finding[] = latest.findings.slice();
          let lessons: Lesson[] = latest.lessons.slice();
          const version = latest.version + 1;
          specs = specs.map((spec) => {
            if (spec.ideaId !== found.id) return spec;
            if (spec.state !== "specced" && spec.state !== "gated") return spec;
            const results = lintSpec(spec);
            const g2 = results.find((result) => result.gate === "G2");
            if (g2) g2.advisory = advisories.get(spec.id) ?? "not configured";
            const moved = nextAfterGate(spec.state, results);
            if (!moved.ok) return spec;
            for (const result of results) {
              if (result.pass) continue;
              for (let index = 0; index < result.codes.length; index += 1) {
                const code = result.codes[index];
                const detail = result.reasons[index] ?? result.reasons[0] ?? code;
                if (!code || !detail) continue;
                findings.push({ code, detail, at: now(), specId: spec.id });
                const count = findings.filter((item) => item.code === code).length;
                const known = LESSON_CHECKS[code];
                if (count >= 2 && known && !lessons.some((lesson) => lesson.code === code)) {
                  lessons.push({
                    id: `l-${String(lessons.length + 1).padStart(4, "0")}`,
                    version,
                    code,
                    detail,
                    gate: known.gate,
                    check: known.check,
                    count,
                    createdAt: now(),
                  });
                }
              }
            }
            return { ...spec, state: moved.state, gates: results, version };
          });
          let nextIdea = { ...found, version, updatedAt: now() };
          nextIdea = syncIdeaState(nextIdea, specs);
          const ideas = latest.ideas.map((item) => (item.id === found.id ? nextIdea : item));
          return { ...latest, version, ideas, specs, findings, lessons };
        });
        return pass(snap, { ideaId: idea.id }, opts?.dryRun === true);
      });
    },

    async dispatch(id: string, opts?: CallOpts & { target?: string }): Promise<Result> {
      return guard(async () => {
        const target = parseTarget(opts?.target ?? defaultTarget);
        if (!target) {
          throw new FoundryError("Pass a target like owner/repo.", 400, "Re-run with --target owner/repo.");
        }
        const current = await readSnapshot(dataDir);
        const spec = specById(current, id);
        if (spec.state === "dispatched" || spec.state === "verified" || spec.state === "rejected") {
          const existing = await readPacket(dataDir, spec.id);
          if (existing) return pass(current, { specId: spec.id, packet: existing }, false, true);
        }
        const packet = buildPacket(spec, target, now(), (await intakeCount(dataDir)) + 1);
        const snap = await save(
          opts,
          "dispatch",
          spec.id,
          "dispatched",
          (latest) => {
            const found = specById(latest, id);
            assertVersion(opts?.recordVersion, found.version);
            const version = latest.version + 1;
            let state = found.state;
            if (state === "gated") {
              const moved = transition(state, { type: "dispatch" });
              if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
              state = moved.state;
            } else if (state !== "dispatched" && state !== "verified" && state !== "rejected") {
              const moved = transition(state, { type: "dispatch" });
              if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
              state = moved.state;
            }
            const specs = latest.specs.map((item) =>
              item.id === found.id ? { ...item, state, version } : item,
            );
            const ideas = latest.ideas.map((item) => {
              if (item.id !== found.ideaId) return item;
              const synced = syncIdeaState({ ...item, updatedAt: now() }, specs);
              return synced.state === item.state ? item : { ...synced, version };
            });
            return { ...latest, version, ideas, specs };
          },
          { packet },
        );
        const stored = await readPacket(dataDir, spec.id);
        return pass(snap, { specId: spec.id, ...(stored ? { packet: stored } : { packet }) }, opts?.dryRun === true);
      });
    },

    async ingest(id: string, report: string, pr: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const parsed = parseReport(report);
        if (!parsed.ok) throw new FoundryError(parsed.error, parsed.status, parsed.next);
        const url = parsePrUrl(pr);
        if (!url) {
          throw new FoundryError(
            "Pass a pull request URL.",
            400,
            "Use an https://github.com/owner/repo/pull/123 URL.",
          );
        }
        const current = await readSnapshot(dataDir);
        const spec = specById(current, id);
        if (
          (spec.state === "verified" && parsed.verdict === "verified" && spec.prUrl === url) ||
          (spec.state === "rejected" && parsed.verdict === "rejected" && spec.prUrl === url)
        ) {
          return pass(current, { specId: spec.id }, false, true);
        }
        const blocked = parsed.verdict === "verified" ? verifyBlocked(spec, current.specs) : null;
        if (blocked) {
          await save(opts, "ingest-blocked", spec.id, spec.state, (latest) => {
            const found = specById(latest, id);
            assertVersion(opts?.recordVersion, found.version);
            const version = latest.version + 1;
            const withFinding = addFinding(latest, "g3-order", blocked, found.id, now(), version);
            return { ...withFinding, version };
          });
          throw new FoundryError(blocked, 400, blocked);
        }
        const snap = await save(opts, "ingest", spec.id, parsed.verdict, (latest) => {
          const found = specById(latest, id);
          assertVersion(opts?.recordVersion, found.version);
          const event = parsed.verdict === "verified" ? "verify_draft" : "reject_draft";
          const moved = transition(found.state, { type: event });
          if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
          const version = latest.version + 1;
          const specs = latest.specs.map((item) =>
            item.id === found.id
              ? { ...item, state: moved.state, prUrl: url, draft: true, version }
              : item,
          );
          const ideas = latest.ideas.map((item) => {
            if (item.id !== found.ideaId) return item;
            const synced = syncIdeaState({ ...item, updatedAt: now() }, specs);
            return { ...synced, version: synced.state === item.state ? item.version : version };
          });
          return { ...latest, version, ideas, specs };
        });
        return pass(snap, { specId: spec.id }, opts?.dryRun === true);
      });
    },

    async park(id: string, opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const snap = await save(opts, "park", id, "parked", (latest) => {
          const version = latest.version + 1;
          const idea = latest.ideas.find((item) => item.id === id);
          if (idea) {
            assertVersion(opts?.recordVersion, idea.version);
            const moved = transition(idea.state, { type: "park" });
            if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
            return {
              ...latest,
              version,
              ideas: latest.ideas.map((item) =>
                item.id === idea.id ? { ...item, state: moved.state, version, updatedAt: now() } : item,
              ),
            };
          }
          const spec = specById(latest, id);
          assertVersion(opts?.recordVersion, spec.version);
          const moved = transition(spec.state, { type: "park" });
          if (!moved.ok) throw new FoundryError(moved.error, moved.status, moved.next);
          return {
            ...latest,
            version,
            specs: latest.specs.map((item) => (item.id === spec.id ? { ...item, state: moved.state, version } : item)),
          };
        });
        return pass(snap, {}, opts?.dryRun === true);
      });
    },

    async state(): Promise<PublicSnapshot> {
      return publish(await readSnapshot(dataDir));
    },

    async chart() {
      const tla = await readFile(join(packageRoot(), "model", "foundry.tla"), "utf8");
      return chartDocument(tla);
    },
  };

  const api = methods;

  return {
    ...api,
    async seed(opts?: CallOpts): Promise<Result> {
      return guard(async () => {
        const current = await readSnapshot(dataDir);
        if (current.ideas.length > 0) return pass(current, {}, false, true);
        if (opts?.dryRun) return pass(current, {}, true, false);
        for (const title of SEED_TITLES) {
          const created = await api.idea(title);
          if (!created.ok || !created.ideaId) {
            throw new FoundryError(
              created.ok ? "Seed did not create an idea." : created.error,
              created.ok ? 500 : created.status,
              created.ok ? "Retry foundry seed." : created.next,
            );
          }
          const id = created.ideaId;
          const steps = [
            () => api.restate(id),
            () => api.approve(id, "Ship the sample slice."),
            () => api.decompose(id),
            () => api.gate(id),
          ];
          for (const step of steps) {
            const result = await step();
            if (!result.ok) throw new FoundryError(result.error, result.status, result.next);
          }
          if (title === "weather widget") {
            const again = await api.gate(id);
            if (!again.ok) throw new FoundryError(again.error, again.status, again.next);
          }
        }
        return pass(await readSnapshot(dataDir));
      });
    },
  };
}

function resolveIdea(snap: Snapshot, id: string): Idea {
  const direct = snap.ideas.find((idea) => idea.id === id);
  if (direct) return direct;
  const spec = snap.specs.find((item) => item.id === id);
  const idea = spec ? snap.ideas.find((item) => item.id === spec.ideaId) : undefined;
  if (!idea) throw new FoundryError(`Unknown id ${id}.`, 404, "Run foundry list.");
  return idea;
}

async function g2Advisory(body: string, reviewUrl: string | undefined): Promise<string> {
  if (!reviewUrl) return "not configured";
  try {
    const response = await fetch(reviewUrl, {
      method: "POST",
      body,
      headers: { "content-type": "text/plain" },
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return "skipped";
    const payload = (await response.json()) as { note?: unknown };
    return typeof payload.note === "string" && payload.note.trim() ? payload.note.trim() : "skipped";
  } catch {
    return "skipped";
  }
}

function addFinding(
  snap: Snapshot,
  code: string,
  detail: string,
  specId: SpecId,
  at: string,
  version: number,
): Snapshot {
  const findings = [...snap.findings, { code, detail, at, specId }];
  const count = findings.filter((item) => item.code === code).length;
  const known = LESSON_CHECKS[code];
  if (count < 2 || !known || snap.lessons.some((lesson) => lesson.code === code)) {
    return { ...snap, findings };
  }
  const lessons = [
    ...snap.lessons,
    {
      id: `l-${String(snap.lessons.length + 1).padStart(4, "0")}`,
      version,
      code,
      detail,
      gate: known.gate,
      check: known.check,
      count,
      createdAt: at,
    },
  ];
  return { ...snap, findings, lessons };
}
