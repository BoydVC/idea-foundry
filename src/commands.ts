import {
  DomainError,
  IllegalTransition,
  type Finding,
  type GateResult,
  type Idea,
  type Snapshot,
  type Spec,
  type Version,
  hasRestatement,
  ideaIdFromCounter,
  lessonIdFromCounter,
  parseIdea,
  parseLesson,
  parseSpec,
  promote,
  prUrl,
  specIdFor,
  stackIdForIdea,
  transition,
  version,
} from "./domain.js";
import { checkSpec, passed } from "./gates.js";
import { DEFAULT_TARGET, buildPacket, parsePacket, parseReport, parseTarget, type ReportDoc } from "./packet.js";
import { type Advisory } from "./review.js";
import { checkFoundryModel } from "./tlc.js";
import { join } from "node:path";
import { lookupGithubDraft, resolveDraftStatus, type DraftProbe } from "./draft-status.js";
import { SEED_TITLES, type Planner } from "./planner.js";
import { Store, type StoreResult } from "./store.js";

export type CommandOk = {
  ok: true;
  dryRun: boolean;
  idempotent?: boolean;
  warning?: string;
  data: unknown;
};

export type CommandErr = {
  ok: false;
  status: number;
  error: string;
  message: string;
  next: string;
  warning?: string;
};

export type CommandResult = CommandOk | CommandErr;

function ok(data: unknown, extra?: { dryRun?: boolean; idempotent?: boolean; warning?: string }): CommandOk {
  return {
    ok: true,
    dryRun: extra?.dryRun ?? false,
    idempotent: extra?.idempotent,
    warning: extra?.warning,
    data,
  };
}

function fail(status: number, error: string, message: string, next: string, warning?: string): CommandErr {
  return { ok: false, status, error, message, next, warning };
}

function stale(actual: number, expected: number | undefined): CommandErr | null {
  if (expected === undefined || expected === actual) return null;
  return fail(
    409,
    "conflict",
    `Stale version. Expected ${expected} and found ${actual}.`,
    "Re-read the record and retry with the current version.",
  );
}

function applyTlc(gates: GateResult[], tlcOk: boolean): GateResult[] {
  if (tlcOk) return gates;
  return gates.map((gate) => {
    if (gate.gate !== "G3") return gate;
    const findings = [...gate.findings, { key: "g3:tlc", detail: "TLC did not pass model/foundry.tla." }];
    return { gate: "G3", pass: false, findings };
  });
}

function fromThrown(error: unknown): CommandErr {
  if (error instanceof DomainError) return fail(error instanceof IllegalTransition ? 422 : 400, error.code, error.message, error.next);
  if (error instanceof Error) return fail(500, "internal", error.message, "Retry the command. If it repeats, reset the data directory.");
  return fail(500, "internal", "Unknown failure.", "Retry the command.");
}

function fromStore<T>(result: StoreResult<T>, pick: (value: T) => unknown): CommandResult {
  if (!result.ok) return result;
  return ok(pick(result.value));
}

function missingIdea(id: string): CommandErr {
  return fail(404, "not_found", `No idea ${id}.`, "Run `foundry idea \"habit tracker export\"` or check the id.");
}

function missingSpec(id: string): CommandErr {
  return fail(404, "not_found", `No spec ${id}.`, "Run `foundry decompose <idea-id>` first.");
}

function bump<T extends { version: Version; updatedAt: string }>(record: T, patch: object, now: string): T {
  return { ...record, ...patch, version: version(record.version + 1), updatedAt: now };
}

function specsForIdea(snap: Snapshot, idea: Idea): Spec[] {
  if (idea.state !== "specced" && idea.state !== "gated" && idea.state !== "verified") return [];
  const stack = snap.stacks.find((item) => item.id === idea.stackId);
  if (!stack) return [];
  return stack.specIds.flatMap((id) => {
    const spec = snap.specs.find((item) => item.id === id);
    return spec ? [spec] : [];
  });
}

function recordFindings(snap: Snapshot, findings: readonly Finding[], now: string): Snapshot {
  const counts = { ...snap.findingCounts };
  const lessons = [...snap.lessons];
  let nextLesson = snap.nextLesson;
  const details = new Map<string, string>();
  for (const finding of findings) {
    counts[finding.key] = (counts[finding.key] ?? 0) + 1;
    details.set(finding.key, finding.detail);
  }
  for (const [key, count] of Object.entries(counts)) {
    if (!details.has(key) || count < 2) continue;
    const detail = details.get(key) ?? key;
    const existing = lessons.find((lesson) => lesson.key === key);
    if (!existing) {
      lessons.push(
        parseLesson({
          id: lessonIdFromCounter(nextLesson),
          version: 1,
          key,
          detail,
          count,
          promotedTo: promote(key),
          createdAt: now,
        }),
      );
      nextLesson += 1;
      continue;
    }
    if (existing.count !== count) {
      const index = lessons.indexOf(existing);
      lessons[index] = parseLesson({ ...existing, detail, count, version: existing.version + 1 });
    }
  }
  return { ...snap, findingCounts: counts, lessons, nextLesson };
}

export function createIdea(store: Store, title: string, dryRun: boolean): CommandResult {
  let clean: string;
  try {
    const snap = store.load();
    const preview = parseIdea({
      id: ideaIdFromCounter(snap.nextIdea),
      version: 1,
      title,
      labels: [],
      state: "raw",
      createdAt: store.now(),
      updatedAt: store.now(),
    });
    clean = preview.title;
    if (dryRun) return ok(preview, { dryRun: true });
  } catch (error) {
    return fromThrown(error);
  }
  try {
    const saved = store.transact({ ideas: [], specs: [] }, (snap) => {
      const idea = parseIdea({
        id: ideaIdFromCounter(snap.nextIdea),
        version: 1,
        title: clean,
        labels: [],
        state: "raw",
        createdAt: store.now(),
        updatedAt: store.now(),
      });
      return { ...snap, nextIdea: snap.nextIdea + 1, ideas: [...snap.ideas, idea] };
    });
    return fromStore(saved, (snap) => snap.ideas[snap.ideas.length - 1]);
  } catch (error) {
    return fromThrown(error);
  }
}

export function restate(store: Store, id: string, planner: Planner, dryRun: boolean, expectedVersion?: number): CommandResult {
  const idea = store.findIdea(id);
  if (!idea) return missingIdea(id);
  const blocked = stale(idea.version, expectedVersion);
  if (blocked) return blocked;
  if (idea.state !== "raw") {
    if (hasRestatement(idea)) return ok(idea, { idempotent: true, dryRun });
    try {
      transition(idea.state, "restate");
    } catch (error) {
      return fromThrown(error);
    }
  }
  let plan;
  try {
    plan = planner.restate(idea.title);
    if (plan.questions.length !== 3) {
      return fail(500, "bad_plan", "The planner must return 3 questions.", "Use the fixture planner.");
    }
  } catch (error) {
    return fromThrown(error);
  }
  const preview = {
    ...idea,
    state: "restated" as const,
    restatement: plan.restatement,
    questions: plan.questions,
    version: version(idea.version + 1),
    updatedAt: store.now(),
  };
  try {
    parseIdea(preview);
  } catch (error) {
    return fromThrown(error);
  }
  if (dryRun) return ok(preview, { dryRun: true });
  try {
    const saved = store.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (snap) => {
      const current = snap.ideas.find((item) => item.id === idea.id);
      if (!current) return snap;
      const next = parseIdea(
        bump(current, { state: transition(current.state, "restate"), restatement: plan.restatement, questions: plan.questions }, store.now()),
      );
      return { ...snap, ideas: snap.ideas.map((item) => (item.id === next.id ? next : item)) };
    });
    return fromStore(saved, (snap) => snap.ideas.find((item) => item.id === idea.id));
  } catch (error) {
    return fromThrown(error);
  }
}

export function approve(store: Store, id: string, note: string | undefined, dryRun: boolean, expectedVersion?: number): CommandResult {
  const idea = store.findIdea(id);
  if (!idea) return missingIdea(id);
  const blocked = stale(idea.version, expectedVersion);
  if (blocked) return blocked;
  if (idea.state === "approved" || idea.state === "specced" || idea.state === "gated" || idea.state === "verified") {
    return ok(idea, { idempotent: true, dryRun });
  }
  if (!note || note.trim() === "") {
    return fail(400, "missing_note", "Approve needs a note.", "Run `foundry approve <id> --note \"Ship the smallest slice\"`.");
  }
  if (idea.state !== "restated") {
    try {
      transition(idea.state, "approve");
    } catch (error) {
      return fromThrown(error);
    }
  }
  const preview = {
    ...idea,
    state: "approved" as const,
    note: note.trim(),
    version: version(idea.version + 1),
    updatedAt: store.now(),
  };
  try {
    parseIdea(preview);
  } catch (error) {
    return fromThrown(error);
  }
  if (dryRun) return ok(preview, { dryRun: true });
  try {
    const saved = store.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (snap) => {
      const current = snap.ideas.find((item) => item.id === idea.id);
      if (!current || current.state !== "restated") return snap;
      const next = parseIdea(bump(current, { state: transition(current.state, "approve"), note: note.trim() }, store.now()));
      return { ...snap, ideas: snap.ideas.map((item) => (item.id === next.id ? next : item)) };
    });
    return fromStore(saved, (snap) => snap.ideas.find((item) => item.id === idea.id));
  } catch (error) {
    return fromThrown(error);
  }
}

export function decompose(store: Store, id: string, planner: Planner, dryRun: boolean, expectedVersion?: number): CommandResult {
  const idea = store.findIdea(id);
  if (!idea) return missingIdea(id);
  const blocked = stale(idea.version, expectedVersion);
  if (blocked) return blocked;
  const snap = store.load();
  if (idea.state === "specced" || idea.state === "gated" || idea.state === "verified") {
    return ok({ idea, specs: specsForIdea(snap, idea) }, { idempotent: true, dryRun });
  }
  if (idea.state !== "approved") {
    try {
      transition(idea.state, "decompose");
    } catch (error) {
      return fromThrown(error);
    }
    return fail(422, "illegal_transition", `Cannot decompose from ${idea.state}.`, "Run `foundry approve <id> --note \"...\"` first.");
  }
  const drafts = planner.decompose(idea.title);
  if (drafts.length < 2 || drafts.length > 6) {
    return fail(500, "bad_plan", "The planner must return 2 to 6 specs.", "Use the fixture planner.");
  }
  const stackId = stackIdForIdea(idea.id);
  const now = store.now();
  try {
    const specs = drafts.map((draft, offset) => {
      const index = offset + 1;
      const specId = specIdFor(idea.id, index);
      const landsAfter = index === 1 ? null : specIdFor(idea.id, index - 1);
      return parseSpec({
        id: specId,
        ideaId: idea.id,
        stackId,
        version: 1,
        index,
        title: draft.title,
        body: draft.body,
        acceptance: draft.acceptance,
        touch: draft.touch,
        maxLines: draft.maxLines,
        landsAfter,
        gates: [],
        state: "specced",
        createdAt: now,
        updatedAt: now,
      });
    });
    const nextIdea = parseIdea(
      bump(idea, { state: transition(idea.state, "decompose"), stackId }, now),
    );
    if (dryRun) return ok({ idea: nextIdea, specs }, { dryRun: true });
    const saved = store.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (current) => {
      const fresh = current.ideas.find((item) => item.id === idea.id);
      if (!fresh || fresh.state !== "approved") return current;
      const built = specs.map((spec) => parseSpec({ ...spec, createdAt: store.now(), updatedAt: store.now() }));
      const ideaNext = parseIdea(bump(fresh, { state: transition(fresh.state, "decompose"), stackId }, store.now()));
      return {
        ...current,
        ideas: current.ideas.map((item) => (item.id === ideaNext.id ? ideaNext : item)),
        specs: [...current.specs, ...built],
        stacks: [
          ...current.stacks,
          { id: stackId, ideaId: idea.id, version: version(1), specIds: built.map((spec) => spec.id) },
        ],
      };
    });
    return fromStore(saved, (value) => ({
      idea: value.ideas.find((item) => item.id === idea.id),
      specs: value.specs.filter((spec) => spec.ideaId === idea.id),
    }));
  } catch (error) {
    return fromThrown(error);
  }
}

function desiredIdeaState(specs: Spec[]): "gated" | "specced" {
  const ready = specs.every((spec) => spec.state === "gated" || spec.state === "dispatched" || spec.state === "verified");
  return ready ? "gated" : "specced";
}

export { probePeerReview, startReviewStub, type Advisory } from "./review.js";

export function gate(store: Store, id: string, dryRun: boolean, advisory?: Advisory, expectedVersion?: number): CommandResult {
  const idea = store.findIdea(id);
  if (!idea) return missingIdea(id);
  const blocked = stale(idea.version, expectedVersion);
  if (blocked) return blocked;
  const tlc = checkFoundryModel();
  if (idea.state !== "specced" && idea.state !== "gated") {
    return fail(422, "illegal_transition", `Cannot gate from ${idea.state}.`, "Run `foundry decompose <id>` first.");
  }
  const snap = store.load();
  const specs = specsForIdea(snap, idea);
  if (specs.length === 0) {
    return fail(422, "missing_stack", "This idea has no specs.", "Run `foundry decompose <id>`.");
  }
  const now = store.now();
  const findings: Finding[] = [];
  const nextSpecs = specs.map((spec) => {
    if (spec.state === "dispatched" || spec.state === "verified" || spec.state === "rejected" || spec.state === "parked") {
      return spec;
    }
    const gates = applyTlc(checkSpec(spec, specs), tlc.ok);
    for (const item of gates) {
      if (!item.pass) findings.push(...item.findings);
    }
    const pass = passed(gates);
    if (spec.state === "specced" && pass) {
      return parseSpec(bump(spec, { state: transition(spec.state, "gate_pass"), gates }, now));
    }
    if (spec.state === "gated" && !pass) {
      return parseSpec(bump(spec, { state: transition(spec.state, "gate_fail"), gates }, now));
    }
    if (spec.state === "gated" && pass) {
      const same = JSON.stringify(spec.gates) === JSON.stringify(gates);
      return same ? spec : parseSpec(bump(spec, { gates }, now));
    }
    const same = JSON.stringify(spec.gates) === JSON.stringify(gates);
    return same ? spec : parseSpec({ ...bump(spec, { gates }, now), state: "specced" });
  });
  const goal = desiredIdeaState(nextSpecs);
  let nextIdea: Idea = idea;
  if (idea.state === "specced" && goal === "gated") {
    nextIdea = parseIdea(bump(idea, { state: transition(idea.state, "gate_pass") }, now));
  } else if (idea.state === "gated" && goal === "specced") {
    nextIdea = parseIdea(bump(idea, { state: transition(idea.state, "gate_fail") }, now));
  }
  const data = { idea: nextIdea, specs: nextSpecs, findings, advisory: advisory ?? { status: "skipped", reason: "not requested" } };
  if (dryRun) return ok(data, { dryRun: true });
  const changed = nextIdea.version !== idea.version || nextSpecs.some((spec, index) => spec.version !== specs[index]?.version);
  if (!changed && findings.length === 0) return ok(data, { idempotent: true });
  try {
    const saved = store.transact(
      {
        ideas: [{ id: idea.id, version: idea.version }],
        specs: specs.map((spec) => ({ id: spec.id, version: spec.version })),
      },
      (current) => {
        let produced: Snapshot = {
          ...current,
          ideas: current.ideas.map((item) => (item.id === nextIdea.id ? nextIdea : item)),
          specs: current.specs.map((item) => nextSpecs.find((spec) => spec.id === item.id) ?? item),
        };
        if (findings.length > 0) produced = recordFindings(produced, findings, store.now());
        return produced;
      },
    );
    return fromStore(saved, (value) => ({
      idea: value.ideas.find((item) => item.id === idea.id),
      specs: value.specs.filter((spec) => spec.ideaId === idea.id),
      findings,
      lessons: value.lessons,
      advisory: advisory ?? { status: "skipped", reason: "not requested" },
    }));
  } catch (error) {
    return fromThrown(error);
  }
}

export function dispatch(store: Store, id: string, dryRun: boolean, expectedVersion?: number): CommandResult {
  const spec = store.findSpec(id);
  if (!spec) return missingSpec(id);
  const blocked = stale(spec.version, expectedVersion);
  if (blocked) return blocked;
  if (spec.state === "dispatched" || spec.state === "verified") {
    if (spec.state === "verified") {
      return ok({ spec, idempotent: true }, { idempotent: true, dryRun });
    }
    try {
      const packet = parsePacket(JSON.parse(store.readText(spec.packetPath)) as unknown);
      return ok({ spec, packet }, { idempotent: true, dryRun });
    } catch (error) {
      return fromThrown(error);
    }
  }
  if (spec.state !== "gated") {
    try {
      transition(spec.state, "dispatch");
    } catch (error) {
      return fromThrown(error);
    }
  }
  const target = parseTarget(process.env.FOUNDRY_TARGET ?? DEFAULT_TARGET);
  const packet = buildPacket(spec, target, store.now());
  const body = `${JSON.stringify(packet, null, 2)}\n`;
  const packetPath = join(store.root, "packets", `${spec.id}.json`);
  if (dryRun) {
    const preview = parseSpec(bump(spec, { state: "dispatched", packetPath }, store.now()));
    return ok({ spec: preview, packet }, { dryRun: true });
  }
  try {
    const saved = store.transact(
      { ideas: [], specs: [{ id: spec.id, version: spec.version }] },
      (snap) => {
        const current = snap.specs.find((item) => item.id === spec.id);
        if (!current || current.state !== "gated") return snap;
        const next = parseSpec(bump(current, { state: transition(current.state, "dispatch"), packetPath }, store.now()));
        return { ...snap, specs: snap.specs.map((item) => (item.id === next.id ? next : item)) };
      },
      { packet: { id: spec.id, body }, intake: packet.intake },
    );
    return fromStore(saved, (value) => ({
      spec: value.specs.find((item) => item.id === spec.id),
      packet,
    }));
  } catch (error) {
    return fromThrown(error);
  }
}

function stackBlock(spec: Spec, specs: readonly Spec[]): CommandErr | null {
  if (spec.landsAfter === null) return null;
  const below = specs.find((item) => item.id === spec.landsAfter);
  if (!below) {
    return fail(422, "stack_order", `Missing the spec below ${spec.id}.`, "Decompose the idea again.");
  }
  if (below.state !== "verified") {
    return fail(
      422,
      "stack_order",
      `${spec.id} cannot be verified while ${below.id} is ${below.state}.`,
      `Verify ${below.id} before ${spec.id}.`,
    );
  }
  return null;
}

export function ingest(
  store: Store,
  id: string,
  reportText: string,
  overrides: { draft?: boolean; pr?: string; probe?: DraftProbe; expectedVersion?: number },
  dryRun: boolean,
): CommandResult {
  const spec = store.findSpec(id);
  if (!spec) return missingSpec(id);
  const blocked = stale(spec.version, overrides.expectedVersion);
  if (blocked) return blocked;
  let report: ReportDoc;
  try {
    report = parseReport(reportText);
  } catch (error) {
    return fromThrown(error);
  }
  const reportDraft = overrides.draft === false || report.draft === false ? false : overrides.draft === true || report.draft;
  const prRaw = overrides.pr ?? report.pr;
  if (spec.state === "verified") {
    const storedPr = spec.prUrl;
    const prForCheck = typeof prRaw === "string" && prRaw.length > 0 ? prRaw : storedPr;
    const decided = resolveDraftStatus(reportDraft, prForCheck, overrides.probe ?? lookupGithubDraft);
    if (!decided.draft) return fail(422, "not_draft", decided.message, decided.next, decided.warning);
    return ok(spec, { idempotent: true, dryRun, warning: decided.warning });
  }
  if (spec.state === "rejected" && report.verdict === "rejected") {
    return ok(spec, { idempotent: true, dryRun });
  }
  if (spec.state !== "dispatched") {
    return fail(422, "illegal_transition", `Cannot ingest from ${spec.state}.`, "Run `foundry dispatch <spec-id>` first.");
  }
  const snap = store.load();
  const siblings = snap.specs.filter((item) => item.stackId === spec.stackId);
  if (report.verdict === "verified") {
    const blocked = stackBlock(spec, siblings);
    if (blocked) return blocked;
    if (!prRaw) {
      return fail(400, "missing_pr", "A verified ingest needs a pull request URL.", "Pass --pr https://github.com/example-org/demo-board/pull/1.");
    }
  }
  const decided = resolveDraftStatus(reportDraft, typeof prRaw === "string" ? prRaw : undefined, overrides.probe ?? lookupGithubDraft);
  if (!decided.draft) {
    return fail(422, "not_draft", decided.message, decided.next, decided.warning);
  }
  try {
    const pr = typeof prRaw === "string" && prRaw.length > 0 ? prUrl(prRaw) : null;
    const now = store.now();
    const nextSpec =
      report.verdict === "rejected"
        ? parseSpec(bump(spec, { state: transition(spec.state, "reject"), reason: report.body || "Rejected by the report." }, now))
        : parseSpec(
            bump(
              spec,
              { state: transition(spec.state, "verify"), prUrl: pr, draft: true },
              now,
            ),
          );
    const idea = snap.ideas.find((item) => item.id === spec.ideaId);
    let nextIdea = idea;
    if (report.verdict === "verified" && idea && (idea.state === "gated" || idea.state === "specced")) {
      const after = siblings.map((item) => (item.id === spec.id ? nextSpec : item));
      const allVerified = after.every((item) => item.state === "verified");
      if (allVerified && idea.state === "gated") {
        nextIdea = parseIdea(bump(idea, { state: transition(idea.state, "close"), draft: true }, now));
      }
    }
    if (dryRun) return ok({ spec: nextSpec, idea: nextIdea }, { dryRun: true, warning: decided.warning });
    const expectIdeas = nextIdea && idea && nextIdea.version !== idea.version ? [{ id: idea.id, version: idea.version }] : [];
    const saved = store.transact({ ideas: expectIdeas, specs: [{ id: spec.id, version: spec.version }] }, (current) => {
      const fresh = current.specs.find((item) => item.id === spec.id);
      if (!fresh || fresh.state !== "dispatched") return current;
      const written =
        report.verdict === "rejected"
          ? parseSpec(bump(fresh, { state: transition(fresh.state, "reject"), reason: report.body || "Rejected by the report." }, store.now()))
          : parseSpec(bump(fresh, { state: transition(fresh.state, "verify"), prUrl: pr, draft: true }, store.now()));
      let ideas = current.ideas;
      const currentIdea = ideas.find((item) => item.id === fresh.ideaId);
      if (report.verdict === "verified" && currentIdea?.state === "gated") {
        const family = current.specs.map((item) => (item.id === written.id ? written : item)).filter((item) => item.stackId === fresh.stackId);
        if (family.every((item) => item.state === "verified")) {
          const closed = parseIdea(bump(currentIdea, { state: transition(currentIdea.state, "close"), draft: true }, store.now()));
          ideas = ideas.map((item) => (item.id === closed.id ? closed : item));
        }
      }
      return { ...current, ideas, specs: current.specs.map((item) => (item.id === written.id ? written : item)) };
    });
    const savedResult = fromStore(saved, (value) => ({
      spec: value.specs.find((item) => item.id === spec.id),
      idea: value.ideas.find((item) => item.id === spec.ideaId),
    }));
    if (savedResult.ok && decided.warning) return { ...savedResult, warning: decided.warning };
    return savedResult;
  } catch (error) {
    return fromThrown(error);
  }
}

export function park(store: Store, id: string, dryRun: boolean, expectedVersion?: number): CommandResult {
  const idea = store.findIdea(id);
  const spec = idea ? undefined : store.findSpec(id);
  if (!idea && !spec) return missingIdea(id);
  const blocked = stale((idea ?? spec)!.version, expectedVersion);
  if (blocked) return blocked;
  if (idea) {
    if (idea.state === "parked") return ok(idea, { idempotent: true, dryRun });
    try {
      const parkedFrom = idea.state;
      const next = parseIdea(bump(idea, { state: transition(idea.state, "park"), parkedFrom }, store.now()));
      if (dryRun) return ok(next, { dryRun: true });
      const saved = store.transact({ ideas: [{ id: idea.id, version: idea.version }], specs: [] }, (snap) => {
        const current = snap.ideas.find((item) => item.id === idea.id);
        if (!current || current.state === "parked") return snap;
        const written = parseIdea(bump(current, { state: transition(current.state, "park"), parkedFrom: current.state }, store.now()));
        return { ...snap, ideas: snap.ideas.map((item) => (item.id === written.id ? written : item)) };
      });
      return fromStore(saved, (value) => value.ideas.find((item) => item.id === idea.id));
    } catch (error) {
      return fromThrown(error);
    }
  }
  if (!spec) return missingSpec(id);
  if (spec.state === "parked") return ok(spec, { idempotent: true, dryRun });
  try {
    const next = parseSpec(bump(spec, { state: transition(spec.state, "park"), parkedFrom: spec.state }, store.now()));
    if (dryRun) return ok(next, { dryRun: true });
    const saved = store.transact({ ideas: [], specs: [{ id: spec.id, version: spec.version }] }, (snap) => {
      const current = snap.specs.find((item) => item.id === spec.id);
      if (!current || current.state === "parked" || current.state === "verified" || current.state === "rejected") return snap;
      const written = parseSpec(bump(current, { state: transition(current.state, "park"), parkedFrom: current.state }, store.now()));
      return { ...snap, specs: snap.specs.map((item) => (item.id === written.id ? written : item)) };
    });
    return fromStore(saved, (value) => value.specs.find((item) => item.id === spec.id));
  } catch (error) {
    return fromThrown(error);
  }
}

export function noteFinding(store: Store, key: string, detail: string): CommandResult {
  try {
    promote(key);
    const saved = store.transact({ ideas: [], specs: [] }, (snap) => recordFindings(snap, [{ key, detail }], store.now()));
    return fromStore(saved, (value) => ({ lessons: value.lessons, findingCounts: value.findingCounts }));
  } catch (error) {
    return fromThrown(error);
  }
}

export function seedDemo(store: Store, planner: Planner): CommandResult {
  const created = [];
  for (const title of SEED_TITLES) {
    const made = createIdea(store, title, false);
    if (!made.ok) return made;
    created.push(made.data);
  }
  const ids = created.map((idea) => (idea as Idea).id);
  const restated = ids.slice(1);
  for (const id of restated) {
    const result = restate(store, id, planner, false);
    if (!result.ok) return result;
  }
  for (const id of ids.slice(2)) {
    const result = approve(store, id, "Ship the smallest slice", false);
    if (!result.ok) return result;
  }
  for (const id of ids.slice(3)) {
    const result = decompose(store, id, planner, false);
    if (!result.ok) return result;
  }
  const gated = ids[4];
  if (gated) {
    const result = gate(store, gated, false);
    if (!result.ok) return result;
  }
  const first = noteFinding(store, "g2:vague-verb", "Replace the vague verb.");
  if (!first.ok) return first;
  const second = noteFinding(store, "g2:vague-verb", "Replace the vague verb.");
  if (!second.ok) return second;
  return ok(store.load());
}

export function readState(store: Store): CommandResult {
  return ok(store.load());
}
