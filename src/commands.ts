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
  normalizeTitle,
  parseIdea,
  parseLesson,
  parseTitle,
  parseSpec,
  promote,
  prUrl,
  specIdFor,
  stackIdForIdea,
  transition,
  version,
} from "./domain.js";
import { backlogDecision, draftBacklogFromEnv, DRAFT_LIMIT, WEEKLY_DRAFT_WARNING, type DraftBacklogProbe } from "./draft-backlog.js";
import { checkSpec, passed } from "./gates.js";
import { weeklyDigest } from "./health.js";
import { lessonFindings } from "./lesson-checks.js";
import { DEFAULT_TARGET, buildPacket, parsePacket, parseReport, parseTarget, type ReportDoc } from "./packet.js";
import { type Advisory } from "./review.js";
import { checkFoundryModel } from "./tlc.js";
import { join } from "node:path";
import { lookupGithubDraft, resolveDraftStatus, type DraftProbe } from "./draft-status.js";
import { draftOf, parseBookmarkExport, parseImportFile } from "./import-notes.js";
import { SEED_TITLES, type Planner, type Restatement } from "./planner.js";
import { Store, quarantineWarning, type StoreResult } from "./store.js";

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
  confirmation?: "unconfirmed";
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

function fail(
  status: number,
  error: string,
  message: string,
  next: string,
  warning?: string,
  confirmation?: "unconfirmed",
): CommandErr {
  return { ok: false, status, error, message, next, warning, confirmation };
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

function applyTlc(gates: GateResult[], tlc: { ok: boolean; detail: string }): GateResult[] {
  if (tlc.ok) return gates;
  const javaMissing = tlc.detail.includes("Java is not on PATH");
  return gates.map((gate) => {
    if (gate.gate !== "G1") return gate;
    const findings = [
      ...gate.findings,
      {
        key: "g1:tlc",
        detail: javaMissing ? "Java is not on PATH. TLC did not run. Install a JDK 21." : "TLC did not pass model/foundry.tla.",
        proof: javaMissing ? 1 : 4,
      } as const,
    ];
    return { gate: "G1" as const, pass: false, findings };
  });
}

function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.key}|${finding.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function mergeLessonFindings(gates: GateResult[], extra: readonly Finding[]): GateResult[] {
  return gates.map((gate) => {
    const prefix = gate.gate.toLowerCase();
    const added = extra.filter((item) => item.key.startsWith(`${prefix}:`));
    if (added.length === 0) return gate;
    const findings = dedupeFindings([...gate.findings, ...added]);
    return { gate: gate.gate, pass: findings.length === 0, findings };
  });
}

function fromThrown(error: unknown): CommandErr {
  if (error instanceof DomainError) {
    const status = error instanceof IllegalTransition || error.code === "stack_order" ? 422 : 400;
    return fail(status, error.code, error.message, error.next);
  }
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

function duplicateTitle(ideas: readonly { id: string; title: string }[], title: string): { id: string; title: string } | undefined {
  const key = normalizeTitle(title);
  if (key.length === 0) return undefined;
  return ideas.find((idea) => normalizeTitle(idea.title) === key);
}

export function createIdea(store: Store, title: string, dryRun: boolean, options?: { allowDuplicate?: boolean }): CommandResult {
  let clean: string;
  let warning: string | undefined;
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
    const existing = duplicateTitle(snap.ideas, clean);
    if (existing && !options?.allowDuplicate) {
      warning = `Idea ${existing.id} already uses the title "${existing.title}". Pass --allow-duplicate to hide this warning.`;
    }
    if (dryRun) return ok(preview, { dryRun: true, warning });
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
    const result = fromStore(saved, (snap) => snap.ideas[snap.ideas.length - 1]);
    if (result.ok && warning) return { ...result, warning };
    return result;
  } catch (error) {
    return fromThrown(error);
  }
}

export function restate(
  store: Store,
  id: string,
  planner: Planner,
  dryRun: boolean,
  expectedVersion?: number,
  draft?: Restatement,
): CommandResult {
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
    plan = draft ?? planner.restate(idea.title);
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
        sketch: draft.sketch,
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
  if (idea.state === "rejected") {
    const blockedIdea = ideaFinal(store, idea.id, "gate");
    if (blockedIdea) return blockedIdea;
  }
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
    const gates = mergeLessonFindings(applyTlc(checkSpec(spec, specs), tlc), lessonFindings(spec, specs, snap.lessons));
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

export function dispatch(
  store: Store,
  id: string,
  dryRun: boolean,
  expectedVersion?: number,
  drafts: DraftBacklogProbe = draftBacklogFromEnv(),
): CommandResult {
  const spec = store.findSpec(id);
  if (!spec) return missingSpec(id);
  const finalIdea = ideaFinal(store, spec.ideaId, "dispatch");
  if (finalIdea) return finalIdea;
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
  const limit = Number(process.env.FOUNDRY_DRAFT_LIMIT ?? DRAFT_LIMIT);
  const backlog = backlogDecision(drafts(target), Number.isInteger(limit) && limit > 0 ? limit : DRAFT_LIMIT);
  if (backlog.refuse) return fail(409, "draft_backlog", backlog.message, backlog.next);
  const packet = buildPacket(spec, target, store.now());
  const body = `${JSON.stringify(packet, null, 2)}\n`;
  const packetPath = join(store.root, "packets", `${spec.id}.json`);
  if (dryRun) {
    const preview = parseSpec(bump(spec, { state: "dispatched", packetPath }, store.now()));
    return ok({ spec: preview, packet }, { dryRun: true, warning: backlog.warning });
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
    const savedResult = fromStore(saved, (value) => ({
      spec: value.specs.find((item) => item.id === spec.id),
      packet,
    }));
    if (savedResult.ok && backlog.warning) return { ...savedResult, warning: backlog.warning };
    return savedResult;
  } catch (error) {
    return fromThrown(error);
  }
}

function ideaFinal(store: Store, id: string, action: "dispatch" | "ingest" | "gate"): CommandErr | null {
  const idea = store.findIdea(id);
  if (idea?.state !== "rejected") return null;
  return fail(
    409,
    "idea_final",
    `Idea ${idea.id} is rejected, so its specs cannot ${action}.`,
    "This idea is final. Start a new idea instead of moving its remaining specs.",
  );
}

function unconfirmedResult(spec: { id: string; state: string }, decided: { warning?: string; message: string; next: string; code?: string; httpStatus?: number }): CommandErr {
  const result = withheldResult(decided);
  if (result.error !== "github_unconfirmed") return result;
  return { ...result, message: `GitHub could not confirm the pull request. The spec stays ${spec.state}.` };
}

function unverify(
  store: Store,
  spec: Extract<Spec, { state: "verified" }>,
  decided: { message: string; next: string; warning?: string },
  dryRun: boolean,
): CommandResult {
  const snap = store.load();
  const siblings = snap.specs.filter((item) => item.stackId === spec.stackId);
  const higher = siblings.filter((item) => item.index > spec.index && item.state === "verified");
  if (higher.length > 0) {
    return fail(
      422,
      "stack_order",
      `Un-verify ${higher.map((item) => item.id).join(", ")} before ${spec.id}.`,
      "Stacks leave verified from the top.",
      decided.warning,
    );
  }
  const now = store.now();
  let nextSpec: Spec;
  try {
    nextSpec = parseSpec(bump(spec, { state: transition(spec.state, "unverify") }, now));
  } catch (error) {
    return fromThrown(error);
  }
  const idea = snap.ideas.find((item) => item.id === spec.ideaId);
  let nextIdea = idea;
  if (idea?.state === "verified") {
    try {
      nextIdea = parseIdea(bump(idea, { state: transition(idea.state, "reopen") }, now));
    } catch (error) {
      return fromThrown(error);
    }
  }
  if (dryRun) return ok({ spec: nextSpec, idea: nextIdea, unverified: true }, { dryRun: true, warning: decided.warning });
  const expectIdeas = nextIdea && idea && nextIdea.version !== idea.version ? [{ id: idea.id, version: idea.version }] : [];
  try {
    const saved = store.transact(
      { ideas: expectIdeas, specs: siblings.map((item) => ({ id: item.id, version: item.version })) },
      (current) => {
      const fresh = current.specs.find((item) => item.id === spec.id);
      if (!fresh || fresh.state !== "verified") return current;
      const higherNow = current.specs.filter((item) => item.stackId === fresh.stackId && item.index > fresh.index && item.state === "verified");
      if (higherNow.length > 0) {
        throw new DomainError(
          "stack_order",
          `Un-verify ${higherNow.map((item) => item.id).join(", ")} before ${fresh.id}.`,
          "Stacks leave verified from the top.",
        );
      }
      const written = parseSpec(bump(fresh, { state: transition(fresh.state, "unverify") }, store.now()));
      let ideas = current.ideas;
      const currentIdea = ideas.find((item) => item.id === fresh.ideaId);
      if (currentIdea?.state === "verified") {
        const reopened = parseIdea(bump(currentIdea, { state: transition(currentIdea.state, "reopen") }, store.now()));
        ideas = ideas.map((item) => (item.id === reopened.id ? reopened : item));
      }
      return { ...current, ideas, specs: current.specs.map((item) => (item.id === written.id ? written : item)) };
    });
    const result = fromStore(saved, (value) => ({
      spec: value.specs.find((item) => item.id === spec.id),
      idea: value.ideas.find((item) => item.id === spec.ideaId),
      unverified: true,
      reason: decided.message,
    }));
    if (result.ok && decided.warning) return { ...result, warning: decided.warning };
    return result;
  } catch (error) {
    return fromThrown(error);
  }
}

function stackBlock(spec: Spec, specs: readonly Spec[]): CommandErr | null {
  const unmet = specs
    .filter((item) => item.id !== spec.id && item.index < spec.index && item.state !== "verified")
    .sort((a, b) => a.index - b.index);
  if (unmet.length > 0) {
    const names = unmet.map((item) => `${item.id} is ${item.state}`).join(", ");
    return fail(422, "stack_order", `${spec.id} cannot be verified while ${names}.`, `Verify ${unmet[0]?.id ?? "the lower spec"} before ${spec.id}.`);
  }
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

function githubStatus(warning: string | undefined): number {
  return warning !== undefined && /rate limit/i.test(warning) ? 429 : 502;
}

function withheldResult(decided: { warning?: string; message: string; next: string; code?: string; httpStatus?: number }): CommandErr {
  if (decided.code === "pr_not_found") return fail(404, "pr_not_found", decided.message, decided.next, decided.warning);
  if (decided.code === "probe_auth") {
    return fail(decided.httpStatus === 403 ? 403 : 401, "probe_auth", decided.message, decided.next, decided.warning);
  }
  if (decided.code === "rate_limit" || /rate limit/i.test(decided.warning ?? "")) {
    return fail(429, "github_unavailable", decided.message, decided.next, decided.warning);
  }
  if (decided.code === "offline" || decided.code === "api_failure") {
    return fail(503, "github_unconfirmed", decided.message, decided.next, decided.warning, "unconfirmed");
  }
  return fail(githubStatus(decided.warning), "github_unavailable", decided.message, decided.next, decided.warning);
}

function rolledIdea(idea: Idea, specs: readonly Spec[], now: string): Idea {
  if (idea.state !== "gated") return idea;
  if (specs.some((spec) => spec.state === "rejected")) {
    return parseIdea(bump(idea, { state: transition(idea.state, "reject"), reason: "A spec was rejected." }, now));
  }
  if (specs.length > 0 && specs.every((spec) => spec.state === "verified")) {
    return parseIdea(bump(idea, { state: transition(idea.state, "close"), draft: true }, now));
  }
  return idea;
}

export function rejectionKey(reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `g3:reject-${slug.length > 0 ? slug : "report"}`;
}

function recordRejection(snap: Snapshot, reason: string, now: string): Snapshot {
  const key = rejectionKey(reason);
  const detail = reason;
  const count = snap.findingCounts[key] ?? 0;
  const needed = count >= 2 ? 1 : 2 - count;
  const findings = Array.from({ length: needed }, () => ({ key, detail, proof: 2 as const }));
  return recordFindings(snap, findings, now);
}

export function ingest(
  store: Store,
  id: string,
  reportText: string,
  overrides: { draft?: boolean; pr?: string; probe?: DraftProbe; expectedVersion?: number; unverify?: boolean },
  dryRun: boolean,
): CommandResult {
  const spec = store.findSpec(id);
  if (!spec) return missingSpec(id);
  const finalIdea = ideaFinal(store, spec.ideaId, "ingest");
  if (finalIdea) return finalIdea;
  const blocked = stale(spec.version, overrides.expectedVersion);
  if (blocked) return blocked;
  let report: ReportDoc;
  try {
    report = parseReport(reportText);
  } catch (error) {
    return fromThrown(error);
  }
  const reportDraft = overrides.draft === false || report.draft === false ? false : overrides.draft === true || report.draft;
  if (overrides.pr && report.pr && overrides.pr !== report.pr) {
    return fail(
      422,
      "pr_mismatch",
      `The --pr URL does not match the report pr line (${report.pr}).`,
      "Pass the same pull request URL in --pr and in the report.",
    );
  }
  const prRaw = overrides.pr ?? report.pr;
  if (spec.state === "verified" || spec.state === "rejected") {
    if (spec.state === "verified" && typeof prRaw === "string" && prRaw.length > 0 && prRaw !== spec.prUrl) {
      return fail(422, "pr_mismatch", `This spec is verified at ${spec.prUrl}.`, "Re-ingest that pull request, not a different URL.");
    }
    const sameVerdict = spec.state === "verified" ? report.verdict === "verified" : report.verdict === "rejected";
    const sameDraft = spec.state !== "verified" || reportDraft === true;
    if (!overrides.unverify && sameVerdict && sameDraft) {
      return ok(spec, { idempotent: true, dryRun });
    }
    if (!overrides.unverify || spec.state !== "verified") {
      return fail(
        409,
        "already_final",
        `Spec ${spec.id} is ${spec.state}. Ingest will not change it.`,
        spec.state === "verified"
          ? "Pass --unverify to leave verified after GitHub confirms the pull request is not a draft."
          : "This rejection is final. Start a new spec to try again.",
      );
    }
    const decided = resolveDraftStatus(reportDraft, spec.prUrl, overrides.probe ?? lookupGithubDraft);
    if (decided.withheld) return unconfirmedResult(spec, decided);
    if (decided.draft) return ok(spec, { idempotent: true, dryRun, warning: decided.warning });
    if (decided.warning) return fail(422, "not_draft", decided.message, decided.next, decided.warning);
    return unverify(store, spec, decided, dryRun);
  }
  if (spec.state !== "dispatched") {
    return fail(422, "illegal_transition", `Cannot ingest from ${spec.state}.`, "Run `foundry dispatch <spec-id>` first.");
  }
  const snap = store.load();
  const earlySiblings = snap.specs.filter((item) => item.stackId === spec.stackId);
  if (report.verdict === "verified") {
    const earlyBlock = stackBlock(spec, earlySiblings);
    if (earlyBlock) return earlyBlock;
    if (!prRaw) {
      return fail(400, "missing_pr", "A verified ingest needs a pull request URL.", "Pass --pr https://github.com/example-org/demo-board/pull/1.");
    }
  }
  const decided = resolveDraftStatus(reportDraft, typeof prRaw === "string" ? prRaw : undefined, overrides.probe ?? lookupGithubDraft);
  if (decided.withheld) {
    if (decided.code === "offline" || decided.code === "api_failure") {
      const pr = typeof prRaw === "string" ? prRaw : undefined;
      store.writeAttempt(spec.id, reportText, pr);
    }
    return unconfirmedResult(spec, decided);
  }
  if (!decided.draft) {
    return fail(422, "not_draft", decided.message, decided.next, decided.warning);
  }
  const freshSnap = store.load();
  const freshSpec = freshSnap.specs.find((item) => item.id === spec.id);
  if (!freshSpec || freshSpec.state !== "dispatched") {
    return fail(409, "conflict", "The spec changed before ingest.", "Re-read the spec and retry.");
  }
  const siblings = freshSnap.specs.filter((item) => item.stackId === freshSpec.stackId);
  if (report.verdict === "verified") {
    const again = stackBlock(freshSpec, siblings);
    if (again) return again;
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
    const previewFamily = siblings.map((item) => (item.id === spec.id ? nextSpec : item));
    const nextIdea = idea ? rolledIdea(idea, previewFamily, now) : idea;
    if (dryRun) return ok({ spec: nextSpec, idea: nextIdea }, { dryRun: true, warning: decided.warning });
    const ideaNow = freshSnap.ideas.find((item) => item.id === freshSpec.ideaId);
    const expectIdeas = nextIdea && ideaNow && nextIdea.version !== ideaNow.version ? [{ id: ideaNow.id, version: ideaNow.version }] : [];
    const saved = store.transact(
      { ideas: expectIdeas, specs: siblings.map((item) => ({ id: item.id, version: item.version })) },
      (current) => {
      const fresh = current.specs.find((item) => item.id === spec.id);
      if (!fresh || fresh.state !== "dispatched") return current;
      if (report.verdict === "verified") {
        const family = current.specs.filter((item) => item.stackId === fresh.stackId);
        const blockedNow = stackBlock(fresh, family);
        if (blockedNow) throw new DomainError("stack_order", blockedNow.message, blockedNow.next);
      }
      const written =
        report.verdict === "rejected"
          ? parseSpec(bump(fresh, { state: transition(fresh.state, "reject"), reason: report.body || "Rejected by the report." }, store.now()))
          : parseSpec(bump(fresh, { state: transition(fresh.state, "verify"), prUrl: pr, draft: true }, store.now()));
      let ideas = current.ideas;
      const currentIdea = ideas.find((item) => item.id === fresh.ideaId);
      if (currentIdea) {
        const family = current.specs.map((item) => (item.id === written.id ? written : item)).filter((item) => item.stackId === fresh.stackId);
        const rolled = rolledIdea(currentIdea, family, store.now());
        if (rolled !== currentIdea) ideas = ideas.map((item) => (item.id === rolled.id ? rolled : item));
      }
      const base = { ...current, ideas, specs: current.specs.map((item) => (item.id === written.id ? written : item)) };
      if (written.state !== "rejected") return base;
      return recordRejection(base, report.body || "Rejected by the report.", store.now());
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

export function recheck(
  store: Store,
  id: string,
  overrides: { pr?: string; probe?: DraftProbe; expectedVersion?: number; unverify?: boolean },
  dryRun: boolean,
): CommandResult {
  const attempt = store.readAttempt(id);
  if (!attempt) {
    return fail(400, "missing_report", "There is no stored report to recheck.", "Pass --report the first time you ingest this spec.");
  }
  return ingest(store, id, attempt.report, { ...overrides, pr: overrides.pr ?? attempt.pr }, dryRun);
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

export function importNotes(store: Store, text: string, planner: Planner, dryRun: boolean): CommandResult {
  let notes;
  try {
    notes = parseImportFile(text);
  } catch (error) {
    return fromThrown(error);
  }
  if (notes.length === 0) {
    return fail(400, "empty_import", "The file has no notes.", "Add a heading or a notes list, then import again.");
  }
  const drafted = notes.map((note) => ({ title: note.title, ...draftOf(note.title, note.note) }));
  if (dryRun) return ok({ count: drafted.length, ideas: drafted }, { dryRun: true });
  const saved: unknown[] = [];
  for (const item of drafted) {
    const made = createIdea(store, item.title, false);
    if (!made.ok) return made;
    const idea = made.data as Idea;
    const restated = restate(store, idea.id, planner, false, idea.version, {
      restatement: item.restatement,
      questions: item.questions,
    });
    if (!restated.ok) return restated;
    saved.push(restated.data);
  }
  return ok({ count: saved.length, ideas: saved });
}

export type SkippedImport = { index: number; id?: string; reason: string; message: string; next: string };

export function importBookmarks(store: Store, text: string, planner: Planner, dryRun: boolean): CommandResult {
  let parsed;
  try {
    parsed = parseBookmarkExport(text);
  } catch (error) {
    return fromThrown(error);
  }
  if (parsed.rows.length === 0 && parsed.invalid.length === 0) {
    return fail(400, "empty_import", "The bookmark file has no rows.", "Add id, author, text, and date, then import again.");
  }
  const snap = store.load();
  const seen = new Set(snap.seenBookmarkIds);
  const titles = new Set(snap.ideas.map((idea) => normalizeTitle(idea.title)));
  const batchIds = new Set<string>();
  const batchText = new Set<string>();
  const skipped: SkippedImport[] = parsed.invalid.map((item) => ({
    index: item.index,
    id: item.id,
    reason: "invalid-row",
    message: item.message,
    next: item.next,
  }));
  const fresh: typeof parsed.rows = [];
  for (const row of parsed.rows) {
    const index = row.index;
    if (seen.has(row.id) || batchIds.has(row.id)) {
      skipped.push({ index, id: row.id, reason: "duplicate-id", message: `Row ${index}: bookmark ${row.id} was already imported.`, next: "Skip that id, or import a new bookmark." });
      continue;
    }
    const key = normalizeTitle(row.text);
    if (titles.has(key)) {
      skipped.push({ index, id: row.id, reason: "duplicate-title", message: `Row ${index}: the text matches an idea already on the board.`, next: "Change the text, or leave the existing idea." });
      continue;
    }
    if (batchText.has(key)) {
      skipped.push({ index, id: row.id, reason: "duplicate-text", message: `Row ${index}: the text repeats an earlier row.`, next: "Keep one row for that text." });
      continue;
    }
    batchIds.add(row.id);
    batchText.add(key);
    fresh.push(row);
  }
  const ready: { id: string; title: string; draft: ReturnType<typeof draftOf> }[] = [];
  for (const row of fresh) {
    const clipped = row.text.length > 200 ? row.text.slice(0, 200).trimEnd() : row.text;
    try {
      const title = parseTitle(clipped);
      ready.push({ id: row.id, title, draft: draftOf(title, row.text) });
    } catch (error) {
      if (error instanceof DomainError) {
        skipped.push({ index: row.index, id: row.id, reason: "invalid-row", message: error.message, next: error.next });
        continue;
      }
      throw error;
    }
  }
  skipped.sort((a, b) => a.index - b.index);
  if (dryRun) return ok({ count: ready.length, skipped, invalid: parsed.invalid.length }, { dryRun: true });
  if (ready.length === 0) {
    const data = { count: 0, skipped, invalid: parsed.invalid.length, ideas: [] as Idea[] };
    if (parsed.invalid.length === 0) return ok(data, { idempotent: true });
    return ok(data);
  }
  const saved = store.transact({ ideas: [], specs: [] }, (current) => {
    let nextIdea = current.nextIdea;
    const ideas = [...current.ideas];
    const ids = [...current.seenBookmarkIds];
    const now = store.now();
    for (const item of ready) {
      ideas.push(
        parseIdea({
          id: ideaIdFromCounter(nextIdea),
          version: 1,
          title: item.title,
          labels: [],
          state: "restated",
          restatement: item.draft.restatement,
          questions: [...item.draft.questions],
          createdAt: now,
          updatedAt: now,
        }),
      );
      nextIdea += 1;
      if (!ids.includes(item.id)) ids.push(item.id);
    }
    return { ...current, nextIdea, ideas, seenBookmarkIds: ids };
  });
  if (!saved.ok) return saved;
  const ideas = saved.value.ideas.slice(-ready.length);
  const data = { count: ideas.length, skipped, invalid: parsed.invalid.length, ideas };
  return ok(data);
}

function proposalBody(lesson: { key: string; detail: string; promotedTo: string }): string {
  const gate = lesson.promotedTo;
  return [
    `# Proposal ${lesson.key}`,
    "",
    `Gate: ${gate}`,
    "",
    "This file is a proposal. Foundry does not apply it.",
    "",
    lesson.detail,
    "",
    "## Failing fixture",
    "",
    "```ts",
    `test("${lesson.key} is still open", () => {`,
    `  const gate = "${gate}";`,
    `  const key = "${lesson.key}";`,
    "  if (gate.length > 0 && key.length > 0) {",
    `    throw new Error("fixture: ${lesson.key} is not encoded in LESSON_CHECKS yet");`,
    "  }",
    "});",
    "```",
    "",
    "## Rule stub",
    "",
    "A `.cursor/rules` stub would restate this lesson. It is not written outside this proposal.",
    "",
  ].join("\n");
}

export function correct(store: Store): CommandResult {
  const lessons = store.load().lessons;
  if (lessons.length === 0) {
    return ok({ proposals: [], lessons: [] }, { idempotent: true });
  }
  const proposals: { path: string; gate: string; key: string; idempotent: boolean }[] = [];
  for (const lesson of lessons) {
    const name = `${lesson.key.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.md`;
    const written = store.writeProposal(name, proposalBody(lesson));
    proposals.push({ path: written.path, gate: lesson.promotedTo, key: lesson.key, idempotent: written.idempotent });
  }
  return ok({ proposals, lessons }, { idempotent: proposals.every((item) => item.idempotent) });
}

export function listQuarantine(store: Store): CommandResult {
  const files = store.quarantineFiles();
  const counts = store.quarantineCounts();
  const warning = quarantineWarning(counts, files);
  return ok({ counts, files, warning }, warning ? { warning } : undefined);
}

export function clearQuarantine(store: Store): CommandResult {
  const archived = store.archiveQuarantine();
  const files = store.quarantineFiles();
  const counts = store.quarantineCounts();
  return ok({ counts, files, archived, idempotent: archived.length === 0 }, { idempotent: archived.length === 0 });
}

export function weekly(store: Store, since: string): CommandResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00.000Z`))) {
    return fail(400, "bad_since", "weekly needs a YYYY-MM-DD date.", "Run `foundry weekly --since 2026-10-24`.");
  }
  try {
    const target = process.env.FOUNDRY_TARGET ?? DEFAULT_TARGET;
    const backlog = draftBacklogFromEnv()(target);
    const targetOpenDrafts = backlog.ok ? backlog.drafts : null;
    const snap = store.load();
    const files = store.quarantineFiles();
    const quarantined = store.quarantineCounts();
    const warnings = [backlog.ok ? undefined : WEEKLY_DRAFT_WARNING, quarantineWarning(quarantined, files)].filter(
      (item): item is string => item !== undefined,
    );
    return ok({ ...weeklyDigest(snap, since, targetOpenDrafts), quarantined }, warnings.length > 0 ? { warning: warnings.join(" ") } : undefined);
  } catch (error) {
    return fromThrown(error);
  }
}

export function noteFinding(store: Store, key: string, detail: string): CommandResult {
  try {
    promote(key);
    const saved = store.transact({ ideas: [], specs: [] }, (snap) => recordFindings(snap, [{ key, detail, proof: 1 }], store.now()));
    return fromStore(saved, (value) => ({ lessons: value.lessons, findingCounts: value.findingCounts }));
  } catch (error) {
    return fromThrown(error);
  }
}

export function seedDemo(store: Store, planner: Planner, options?: { fresh?: boolean }): CommandResult {
  if (!options?.fresh && store.load().ideas.length > 0) {
    return fail(
      409,
      "store_not_empty",
      "The data directory already has ideas.",
      "Pass --fresh to replace this store, or choose an empty --data directory.",
    );
  }
  if (options?.fresh) store.reset();
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
