import {
  CommandError,
  type Idea,
  type IdeaId,
  type Packet,
  type Snapshot,
  type Spec,
  type SpecId,
  type GateResult,
  type Lesson,
} from "./domain.ts";
import { evaluateGates, type TlcView } from "./gates.ts";
import { buildPacket } from "./packet.ts";
import { fixturePlanner, SEED_TITLES, type Planner } from "./planner.ts";
import type { JournalEntry, Store } from "./store.ts";
import { transition } from "./transition.ts";

export type TlcRunner = () => { ok: boolean; detail: string };

const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/;

export function createIdea(store: Store, rawTitle: string, now: string, dryRun = false): Idea {
  const title = cleanTitle(rawTitle);
  return commit(store, dryRun, (draft) => {
    const idea = newIdea(draft, title, now);
    draft.ideas.push(idea);
    return { result: idea, journal: [{ stream: "ideas", record: idea }] };
  });
}

export function restateIdea(store: Store, id: IdeaId, planner: Planner, dryRun = false): Idea {
  return commit(store, dryRun, (draft) => {
    const idea = mustIdea(draft, id);
    if (idea.state === "restated" && idea.restatement && idea.questions) {
      return { result: idea };
    }
    const planned = planner.restate(idea.title);
    moveIdea(idea, { type: "restate" });
    idea.restatement = planned.restatement;
    idea.questions = planned.questions;
    return { result: idea };
  });
}

export function approveIdea(store: Store, id: IdeaId, note: string, dryRun = false): Idea {
  const clean = note.trim();
  if (!clean) {
    throw new CommandError('Approve needs a note.', 'Re-run with --note "what to keep".');
  }
  return commit(store, dryRun, (draft) => {
    const idea = mustIdea(draft, id);
    if (idea.state === "approved" && idea.note === clean) {
      return { result: idea };
    }
    moveIdea(idea, { type: "approve" });
    idea.note = clean;
    return { result: idea };
  });
}

export function decomposeIdea(store: Store, id: IdeaId, planner: Planner, dryRun = false): Spec[] {
  return commit(store, dryRun, (draft) => {
    const idea = mustIdea(draft, id);
    const existing = draft.specs.filter((spec) => spec.ideaId === idea.id);
    if (existing.length > 0 && idea.state === "specced") {
      return { result: existing };
    }
    moveIdea(idea, { type: "decompose" });
    const planned = planner.decompose(idea.title, idea.id);
    if (planned.length < 2 || planned.length > 6) {
      throw new CommandError(
        `Decompose produced ${planned.length} specs.`,
        "A stack must contain 2 to 6 specs.",
      );
    }
    const specs = planned.map((item) => {
      const spec: Spec = {
        kind: "spec",
        id: item.id,
        ideaId: idea.id,
        version: 1,
        state: "specced",
        order: item.order,
        title: item.title,
        doneWhen: item.doneWhen,
        body: item.body,
        acceptance: item.acceptance,
        touchMap: item.touchMap,
        maxChangedLines: item.maxChangedLines,
        piiClause: item.piiClause,
        draftPr: null,
        prUrl: null,
        reportExcerpt: null,
      };
      return spec;
    });
    draft.specs.push(...specs);
    return { result: specs };
  });
}

export function gateIdea(
  store: Store,
  id: IdeaId,
  runner: TlcRunner,
  now: string,
  dryRun = false,
): { idea: Idea; specs: Spec[]; gates: GateResult[] } {
  const tlc = ensureTlc(store, runner, now, dryRun);
  return commit(store, dryRun, (draft) => {
    const idea = mustIdea(draft, id);
    const mine = draft.specs.filter((spec) => spec.ideaId === idea.id);
    if (mine.length === 0) {
      throw new CommandError(`Idea ${id} has no specs.`, "Run foundry decompose <id> first.");
    }
    const fresh: GateResult[] = [];
    for (const spec of mine) {
      if (spec.state === "dispatched" || spec.state === "verified" || spec.state === "rejected" || spec.state === "parked") {
        continue;
      }
      const gates = evaluateGates(spec, {
        specs: draft.specs,
        tlc,
        bannedPhrases: draft.bannedPhrases,
        at: now,
      });
      fresh.push(...gates);
      const passed = gates.every((gate) => gate.pass);
      if (passed) {
        if (spec.state === "specced") {
          moveSpec(spec, { type: "gate_pass" });
        }
      } else if (spec.state === "gated") {
        moveSpec(spec, { type: "gate_fail" });
      }
    }
    draft.gates = draft.gates.filter((gate) => !mine.some((spec) => spec.id === gate.specId)).concat(fresh);
    const open = mine.filter((spec) => spec.state === "specced");
    if (open.length === 0 && idea.state === "specced") {
      moveIdea(idea, { type: "gate_pass" });
    }
    if (open.length > 0 && idea.state === "gated") {
      moveIdea(idea, { type: "gate_fail" });
    }
    return { result: { idea, specs: mine, gates: fresh } };
  });
}

export function dispatchSpec(store: Store, id: SpecId, dryRun = false): Packet {
  return commit(store, dryRun, (draft) => {
    const spec = mustSpec(draft, id);
    const existing = draft.packets.find((packet) => packet.id === spec.id);
    if (spec.state === "dispatched" && existing) {
      return { result: existing };
    }
    moveSpec(spec, { type: "dispatch" });
    const stack = draft.specs.filter((item) => item.ideaId === spec.ideaId);
    const packet = buildPacket(spec, stack);
    draft.packets = draft.packets.filter((item) => item.id !== packet.id).concat(packet);
    rollup(mustIdea(draft, spec.ideaId), stack);
    return { result: packet };
  });
}

export function ingestSpec(
  store: Store,
  id: SpecId,
  input: { draft: boolean; outcome: "verified" | "rejected"; prUrl: string; reportText: string },
  dryRun = false,
): Spec {
  if (!PR_URL.test(input.prUrl)) {
    throw new CommandError(
      "PR url is not a GitHub pull request url.",
      "Pass an https://github.com/<org>/<repo>/pull/<number> url for a draft pull request.",
    );
  }
  return commit(store, dryRun, (draft) => {
    const spec = mustSpec(draft, id);
    const idea = mustIdea(draft, spec.ideaId);
    const stack = draft.specs.filter((item) => item.ideaId === spec.ideaId);
    const belowVerified = stack.filter((item) => item.order < spec.order).every((item) => item.state === "verified");
    if (input.outcome === "rejected") {
      if (spec.state !== "rejected") {
        moveSpec(spec, { type: "ingest_rejected" });
        spec.draftPr = input.draft;
        spec.prUrl = input.prUrl;
        spec.reportExcerpt = input.reportText.slice(0, 500);
      }
      rollup(idea, stack);
      return { result: spec };
    }
    if (spec.state === "verified" && spec.draftPr === true) {
      return { result: spec };
    }
    moveSpec(spec, { type: "ingest_verified", draft: input.draft, belowVerified });
    spec.draftPr = true;
    spec.prUrl = input.prUrl;
    spec.reportExcerpt = input.reportText.slice(0, 500);
    rollup(idea, stack);
    return { result: spec };
  });
}

export function parkIdea(store: Store, id: IdeaId, dryRun = false): Idea {
  return commit(store, dryRun, (draft) => {
    const idea = mustIdea(draft, id);
    if (idea.state === "parked") {
      return { result: idea };
    }
    moveIdea(idea, { type: "park" });
    return { result: idea };
  });
}

export function nextPacket(store: Store): Packet | null {
  const snap = store.read();
  const waiting = snap.packets.filter((packet) => snap.specs.some((spec) => spec.id === packet.id && spec.state === "dispatched"));
  waiting.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return waiting[0] ?? null;
}

export function listIdeas(store: Store): Idea[] {
  return store.read().ideas;
}

export function showIdea(store: Store, id: IdeaId): { idea: Idea; specs: Spec[]; gates: GateResult[]; packets: Packet[] } {
  const snap = store.read();
  const idea = mustIdea(snap, id);
  return {
    idea,
    specs: snap.specs.filter((spec) => spec.ideaId === id).sort((a, b) => a.order - b.order),
    gates: snap.gates.filter((gate) => snap.specs.some((spec) => spec.id === gate.specId && spec.ideaId === id)),
    packets: snap.packets.filter((packet) => packet.ideaId === id),
  };
}

export function recordFinding(store: Store, text: string, now: string, dryRun = false): Lesson | null {
  const finding = text.trim();
  if (!finding) {
    throw new CommandError("A finding needs text.", "Pass the repeated verifier finding as a sentence.");
  }
  return commit(store, dryRun, (draft) => {
    const row = draft.findings.find((item) => item.text === finding);
    if (!row) {
      draft.findings.push({ text: finding, count: 1 });
      return { result: null };
    }
    row.count += 1;
    if (row.count < 2 || draft.lessons.some((lesson) => lesson.finding === finding)) {
      return { result: null };
    }
    const lesson: Lesson = {
      id: `l-${String(draft.lessons.length + 1).padStart(4, "0")}`,
      finding,
      count: row.count,
      encodedAs: "G2",
      at: now,
    };
    draft.lessons.push(lesson);
    if (!draft.bannedPhrases.includes(finding.toLowerCase())) {
      draft.bannedPhrases.push(finding.toLowerCase());
    }
    return { result: lesson, journal: [{ stream: "lessons", record: lesson }] };
  });
}

export function seedIfEmpty(store: Store, now: string): Idea[] {
  if (store.read().ideas.length > 0) {
    return [];
  }
  return SEED_TITLES.map((title) => createIdea(store, title, now, false));
}

export function parseReport(text: string): { draft: boolean; outcome: "verified" | "rejected" } {
  const draftLine = text.match(/^draft:\s*(true|false)\s*$/m);
  const outcomeLine = text.match(/^outcome:\s*(verified|rejected)\s*$/m);
  if (!draftLine?.[1] || !outcomeLine?.[1]) {
    throw new CommandError(
      "Report is missing a draft line or an outcome line.",
      "Add lines `draft: true` and `outcome: verified` or `outcome: rejected`.",
    );
  }
  const outcome = outcomeLine[1];
  if (outcome !== "verified" && outcome !== "rejected") {
    throw new CommandError("Outcome must be verified or rejected.", "Edit the report outcome line and retry.");
  }
  return { draft: draftLine[1] === "true", outcome };
}

export function defaultPlanner(): Planner {
  return fixturePlanner;
}

function ensureTlc(store: Store, runner: TlcRunner, now: string, dryRun: boolean): TlcView {
  const cached = store.read().tlc;
  if (cached) {
    return cached;
  }
  let ran: { ok: boolean; detail: string };
  try {
    ran = runner();
  } catch (error) {
    const message = error instanceof Error ? error.message : "TLC failed to start.";
    throw new CommandError(message, "Install Java 21 and tla2tools.jar, then run npm run tlc.");
  }
  const view = { ok: ran.ok, detail: clip(ran.detail) };
  if (!dryRun) {
    const snap = store.read();
    store.update(snap.version, (draft) => {
      draft.tlc = { ...view, at: now };
      return { result: draft.tlc };
    });
  }
  return view;
}

function rollup(idea: Idea, stack: Spec[]): void {
  const ready = stack.every((spec) => spec.state === "dispatched" || spec.state === "verified" || spec.state === "rejected");
  if (ready && idea.state === "gated") {
    moveIdea(idea, { type: "dispatch" });
  }
  const allVerified = stack.every((spec) => spec.state === "verified");
  if (allVerified && idea.state === "dispatched") {
    moveIdea(idea, { type: "ingest_verified", draft: true, belowVerified: true });
  }
  const settled = stack.every((spec) => spec.state === "verified" || spec.state === "rejected");
  const anyRejected = stack.some((spec) => spec.state === "rejected");
  if (settled && anyRejected && idea.state === "dispatched") {
    moveIdea(idea, { type: "ingest_rejected" });
  }
}

function moveIdea(idea: Idea, event: Parameters<typeof transition>[1]): void {
  const moved = transition(idea.state, event);
  if (!moved.ok) {
    throw new CommandError(moved.reason, moved.next);
  }
  idea.state = moved.state;
  idea.version += 1;
}

function moveSpec(spec: Spec, event: Parameters<typeof transition>[1]): void {
  const moved = transition(spec.state, event);
  if (!moved.ok) {
    throw new CommandError(moved.reason, moved.next);
  }
  spec.state = moved.state;
  spec.version += 1;
}

function newIdea(draft: Snapshot, title: string, now: string): Idea {
  const id = `i-${String(draft.nextIdea).padStart(4, "0")}` as IdeaId;
  draft.nextIdea += 1;
  return {
    kind: "idea",
    id,
    version: 1,
    state: "raw",
    title,
    restatement: null,
    questions: null,
    note: null,
    createdAt: now,
  };
}

function mustIdea(snap: Snapshot, id: IdeaId): Idea {
  const idea = snap.ideas.find((item) => item.id === id);
  if (!idea) {
    throw new CommandError(`No idea ${id}.`, "Run foundry list to see idea ids.");
  }
  return idea;
}

function mustSpec(snap: Snapshot, id: SpecId): Spec {
  const spec = snap.specs.find((item) => item.id === id);
  if (!spec) {
    throw new CommandError(`No spec ${id}.`, "Run foundry show <idea-id> to see spec ids.");
  }
  return spec;
}

function cleanTitle(raw: string): string {
  const title = raw.trim();
  if (!title) {
    throw new CommandError("Title is empty.", 'Pass a title. Example: foundry idea "weather widget".');
  }
  if (title.length > 120) {
    throw new CommandError("Title is longer than 120 characters.", "Shorten the title and retry.");
  }
  return title;
}

function commit<T>(
  store: Store,
  dryRun: boolean,
  change: (draft: Snapshot) => { result: T; journal?: JournalEntry[] },
): T {
  const seen = store.read();
  if (dryRun) {
    return change(structuredClone(seen)).result;
  }
  return store.update(seen.version, change);
}

function clip(detail: string): string {
  if (detail.length <= 2500) {
    return detail;
  }
  return detail.slice(detail.length - 2500);
}
