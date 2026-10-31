import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { CasConflict, type IdeaId, type SpecId } from "../src/domain.ts";
import { SEED_TITLES, fixturePlanner } from "../src/planner.ts";
import {
  approveIdea,
  createIdea,
  decomposeIdea,
  dispatchSpec,
  gateIdea,
  ingestSpec,
  nextPacket,
  parkIdea,
  recordFinding,
  restateIdea,
} from "../src/service.ts";
import { openStore } from "../src/store.ts";

const now = "2026-01-15T00:00:00.000Z";
const tlcOk = () => ({ ok: true, detail: "TLC pass" });
const pr = "https://github.com/BoydVC/idea-foundry/pull/4";

function tempStore() {
  return openStore(fs.mkdtempSync(path.join(os.tmpdir(), "foundry-")));
}

function ready(title = "kitchen timer") {
  const dirStore = tempStore();
  const idea = createIdea(dirStore, title, now);
  restateIdea(dirStore, idea.id, fixturePlanner);
  approveIdea(dirStore, idea.id, "Use the fixture only");
  const specs = decomposeIdea(dirStore, idea.id, fixturePlanner);
  gateIdea(dirStore, idea.id, tlcOk, now);
  return { store: dirStore, ideaId: idea.id, specs };
}

test("idea, restate, and approve round-trip", () => {
  const store = tempStore();
  const created = createIdea(store, "weather widget", now);
  expect(created.state).toBe("raw");
  const restated = restateIdea(store, created.id, fixturePlanner);
  expect(restated.state).toBe("restated");
  expect(restated.questions).toHaveLength(3);
  const approved = approveIdea(store, created.id, "Skip extra charts");
  expect(approved.state).toBe("approved");
  expect(approved.note).toBe("Skip extra charts");
  expect(store.read().ideas[0]?.state).toBe("approved");
});

test("five seed ideas decompose into at least 14 specs", () => {
  const store = tempStore();
  let count = 0;
  for (const title of SEED_TITLES) {
    const idea = createIdea(store, title, now);
    restateIdea(store, idea.id, fixturePlanner);
    approveIdea(store, idea.id, "Use the fixture only");
    count += decomposeIdea(store, idea.id, fixturePlanner).length;
  }
  expect(SEED_TITLES).toHaveLength(5);
  expect(count).toBeGreaterThanOrEqual(14);
});

test("a stale version is a 409 and the first write stays", () => {
  const store = tempStore();
  const seen = store.read().version;
  store.update(seen, (draft) => {
    draft.nextIdea = 2;
    return { result: true };
  });
  expect(() => store.update(seen, (draft) => ({ result: draft }))).toThrow(CasConflict);
  try {
    store.update(seen, () => ({ result: null }));
  } catch (error) {
    expect(error).toBeInstanceOf(CasConflict);
    expect((error as CasConflict).status).toBe(409);
  }
  expect(store.read().version).toBe(seen + 1);
});

test("dry-run does not write", () => {
  const store = tempStore();
  const before = store.read().version;
  const idea = createIdea(store, "trivia scoring", now, true);
  expect(idea.state).toBe("raw");
  expect(store.read().version).toBe(before);
  expect(store.read().ideas).toHaveLength(0);
});

test("gates move a clean stack to gated and a failed TLC run leaves it specced", () => {
  const store = tempStore();
  const idea = createIdea(store, "kitchen timer", now);
  restateIdea(store, idea.id, fixturePlanner);
  approveIdea(store, idea.id, "Use the fixture only");
  decomposeIdea(store, idea.id, fixturePlanner);
  const passed = gateIdea(store, idea.id, tlcOk, now);
  expect(passed.gates.every((gate) => gate.pass)).toBe(true);
  expect(passed.idea.state).toBe("gated");
  expect(passed.specs.every((spec) => spec.state === "gated")).toBe(true);

  const other = tempStore();
  const raw = createIdea(other, "kitchen timer", now);
  restateIdea(other, raw.id, fixturePlanner);
  approveIdea(other, raw.id, "Use the fixture only");
  decomposeIdea(other, raw.id, fixturePlanner);
  const failed = gateIdea(other, raw.id, () => ({ ok: false, detail: "mutation" }), now);
  expect(failed.gates.some((gate) => gate.gate === "G3" && !gate.pass)).toBe(true);
  expect(failed.idea.state).toBe("specced");
  expect(failed.specs.every((spec) => spec.state === "specced")).toBe(true);
});

test("dispatch and ingest round-trip a draft packet and refuse a non-draft", () => {
  const { store, ideaId, specs } = ready();
  const first = specs[0];
  const second = specs[1];
  expect(first && second).toBeTruthy();
  if (!first || !second) {
    return;
  }
  const packet = dispatchSpec(store, first.id);
  expect(packet.protocol).toBe("dd.intake/v1");
  expect(packet.op).toBe("intake");
  expect(packet.constraints).toEqual({ draftOnly: true, noMerge: true, noDeploy: true });
  expect(packet.dependsOn).toBeNull();
  expect(nextPacket(store)?.id).toBe(first.id);
  const upperEarly = dispatchSpec(store, second.id);
  expect(upperEarly.dependsOn).toBe(first.id);
  expect(() =>
    ingestSpec(store, second.id, { draft: true, outcome: "verified", prUrl: pr, reportText: "draft: true\noutcome: verified\n" }),
  ).toThrow(/lower spec/);
  expect(() =>
    ingestSpec(store, first.id, { draft: false, outcome: "verified", prUrl: pr, reportText: "draft: false\noutcome: verified\n" }),
  ).toThrow(/not a draft/);
  expect(store.read().specs.find((spec) => spec.id === first.id)?.state).toBe("dispatched");
  const verified = ingestSpec(store, first.id, {
    draft: true,
    outcome: "verified",
    prUrl: pr,
    reportText: "draft: true\noutcome: verified\n",
  });
  expect(verified.state).toBe("verified");
  expect(verified.draftPr).toBe(true);
  const upperPacket = dispatchSpec(store, second.id);
  expect(upperPacket.dependsOn).toBe(first.id);
  const upper = ingestSpec(store, second.id, {
    draft: true,
    outcome: "verified",
    prUrl: pr,
    reportText: "draft: true\noutcome: verified\n",
  });
  expect(upper.state).toBe("verified");
  expect(store.read().ideas.find((idea) => idea.id === ideaId)?.state).toBe("verified");
  expect(nextPacket(store)).toBeNull();
});

test("a repeated finding becomes a G2 lesson", () => {
  const store = tempStore();
  expect(recordFinding(store, "placeholder acceptance", now)).toBeNull();
  const lesson = recordFinding(store, "placeholder acceptance", now);
  expect(lesson?.encodedAs).toBe("G2");
  const lessons = fs.readFileSync(path.join(store.dir, "lessons.jsonl"), "utf8");
  expect(lessons).toMatch(/placeholder acceptance/);
  expect(store.read().bannedPhrases).toContain("placeholder acceptance");
});

test("park and a bad approve say what to do next", () => {
  const store = tempStore();
  const idea = createIdea(store, "markdown note export", now);
  expect(() => approveIdea(store, idea.id, "too soon")).toThrow(/Cannot approve/);
  const parked = parkIdea(store, idea.id);
  expect(parked.state).toBe("parked");
});

test("record ids stay branded shapes", () => {
  const store = tempStore();
  const idea = createIdea(store, "weather widget", now);
  expect(idea.id).toMatch(/^i-\d{4}$/);
  restateIdea(store, idea.id as IdeaId, fixturePlanner);
  approveIdea(store, idea.id, "Use the fixture only");
  const specs = decomposeIdea(store, idea.id, fixturePlanner);
  expect(specs[0]?.id).toMatch(/^s-\d{4}-\d+$/);
  expect(specs[0]?.id).toBe("s-0001-1" as SpecId);
});
