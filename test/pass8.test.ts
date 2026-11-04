import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { approve, createIdea, decompose, dispatch, gate, importBookmarks, ingest, recheck, restate } from "../src/commands.js";
import { compareRecordIds, ideaId, parseTitle } from "../src/domain.js";
import { WEEKLY_DRAFT_WARNING } from "../src/draft-backlog.js";
import { pipelineHealth } from "../src/health.js";
import { MAX_IMPORT_BYTES, Store } from "../src/store.js";
import { FixturePlanner } from "../src/planner.js";
import { weekly } from "../src/commands.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();
const pr = "https://github.com/example-org/demo-board/pull/4";
const offline = () => ({ ok: false as const, warning: "GitHub API was unreachable.", trustReport: false as const, code: "offline" as const });

function report(verdict: "verified" | "rejected", draft = true, body = "Synthetic note."): string {
  return ["---", `verdict: ${verdict}`, `draft: ${draft}`, `pr: ${pr}`, "---", "", body].join("\n");
}

function stack(title = "habit tracker export") {
  const store = tempStore();
  const made = createIdea(store, title, false);
  if (!made.ok) throw new Error("create");
  const id = (made.data as { id: string }).id;
  restate(store, id, planner, false);
  approve(store, id, "Ship the smallest slice", false);
  decompose(store, id, planner, false);
  const gated = gate(store, id, false);
  if (!gated.ok) throw new Error(JSON.stringify(gated));
  const specs = () => store.load().specs.filter((spec) => spec.ideaId === id).sort((a, b) => a.index - b.index);
  return { store, id, specs };
}

function eventKeys(root: string): string[] {
  const text = readFileSync(join(root, "events.jsonl"), "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as { id: string; version: number };
      return `${parsed.id}|${parsed.version}`;
    });
}

function assertEventsMatchState(store: Store): void {
  const snap = store.load();
  const keys = eventKeys(store.root);
  for (const idea of snap.ideas) {
    expect(keys.filter((key) => key === `${idea.id}|${idea.version}`)).toHaveLength(1);
  }
  for (const spec of snap.specs) {
    expect(keys.filter((key) => key === `${spec.id}|${spec.version}`)).toHaveLength(1);
  }
}

describe("pass 8", () => {
  test("a crash after the snapshot and a torn log line both repair on the next open", () => {
    const store = tempStore();
    expect(createIdea(store, "habit tracker export", false).ok).toBe(true);
    assertEventsMatchState(store);
    const eventsPath = join(store.root, "events.jsonl");
    const lines = readFileSync(eventsPath, "utf8").trim().split("\n");
    lines.pop();
    writeFileSync(eventsPath, lines.length === 0 ? "" : `${lines.join("\n")}\n`);
    const reopened = new Store(store.root, () => "2026-01-01T00:00:00.000Z");
    reopened.load();
    assertEventsMatchState(reopened);

    writeFileSync(eventsPath, `${readFileSync(eventsPath, "utf8")}{"at":"202`, "utf8");
    expect(createIdea(reopened, "weather widget", false).ok).toBe(true);
    const text = readFileSync(eventsPath, "utf8");
    expect(text.includes('{"at":"202{')).toBe(false);
    for (const line of text.trim().split("\n")) JSON.parse(line);
    assertEventsMatchState(reopened);
  });

  test("idea 10000 imports after the old four-digit ceiling", () => {
    const store = tempStore();
    writeFileSync(
      join(store.root, "state.json"),
      `${JSON.stringify({ version: 0, nextIdea: 9991, nextLesson: 1, ideas: [], specs: [], stacks: [], lessons: [], findingCounts: {}, seenBookmarkIds: [] }, null, 2)}\n`,
    );
    const bookmarks = Array.from({ length: 20 }, (_, index) => ({
      id: `bk-wide-${index}`,
      author: "synthetic-author",
      text: `Synthetic wide id card ${index}.`,
      date: "2026-10-20",
    }));
    const imported = importBookmarks(store, JSON.stringify({ bookmarks }), planner, false);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const ids = store.load().ideas.map((idea) => idea.id);
    expect(ids).toContain("i-10000");
    expect(ideaId("i-0001")).toBe("i-0001");
    expect(ideaId("i-10000")).toBe("i-10000");
    expect(["i-10000", "i-0002", "i-9999"].sort(compareRecordIds)).toEqual(["i-0002", "i-9999", "i-10000"]);
  });

  test("a rejected idea blocks dispatch of the specs that remain", () => {
    const { store, id, specs } = stack();
    const [bottom, next] = specs();
    if (!bottom || !next) throw new Error("missing specs");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    expect(ingest(store, bottom.id, report("rejected", true, "Tests failed: flaky timer"), { pr, probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    expect(store.findIdea(id)?.state).toBe("rejected");
    const sent = dispatch(store, next.id, false);
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error).toBe("idea_final");
    expect(store.findSpec(next.id)?.state).toBe("gated");
  });

  test("recheck retries a stored report and an offline unverify names the verified state", () => {
    const { store, specs } = stack("weather widget");
    const bottom = specs()[0];
    if (!bottom) throw new Error("missing spec");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    const held = ingest(store, bottom.id, report("verified", true), { pr, probe: offline }, false);
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.confirmation).toBe("unconfirmed");
    const again = recheck(store, bottom.id, { probe: () => ({ ok: true, draft: true }) }, false);
    expect(again.ok).toBe(true);
    expect(store.findSpec(bottom.id)?.state).toBe("verified");
    const offlineUnverify = ingest(store, bottom.id, report("verified", false), { pr, unverify: true, probe: offline }, false);
    expect(offlineUnverify.ok).toBe(false);
    if (!offlineUnverify.ok) {
      expect(offlineUnverify.message).toMatch(/stays verified/);
      expect(offlineUnverify.message).not.toMatch(/stays dispatched/);
    }
    expect(store.findSpec(bottom.id)?.state).toBe("verified");
  });

  test("a mixed stack shows in progress while the idea stays gated", () => {
    const { store, id, specs } = stack("palette mixer");
    const family = specs();
    expect(family.length).toBeGreaterThanOrEqual(3);
    const [bottom, second] = family;
    if (!bottom || !second) throw new Error("missing specs");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    expect(ingest(store, bottom.id, report("verified", true), { pr, probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    expect(dispatch(store, second.id, false).ok).toBe(true);
    expect(store.findIdea(id)?.state).toBe("gated");
    const health = pipelineHealth(store.load());
    expect(health.ideasInProgress).toBe(1);
    expect(health.ideasByState.gated).toBe(1);
  });

  test("the import cap is bytes and is visible before a read would be useful", () => {
    const store = tempStore();
    const path = join(store.root, "too-big.json");
    writeFileSync(path, "x".repeat(MAX_IMPORT_BYTES + 1));
    expect(() => store.readImport(path)).toThrow(/bytes/);
    expect(() => store.readImport(path)).toThrow(/before the file is read/);
  });

  test("titles reject bidi and zero-width characters and NFC duplicates match", () => {
    expect(() => parseTitle(`habit\u202Etracker`)).toThrow(/bidi|control|zero-width/);
    expect(() => parseTitle("habit\ttracker")).toThrow(/control|bidi|zero-width/);
    expect(() => parseTitle("habit\u200Btracker")).toThrow(/zero-width|control|bidi/);
    const store = tempStore();
    const first = createIdea(store, "e\u0301clair export", false);
    expect(first.ok).toBe(true);
    if (first.ok) expect((first.data as { title: string }).title).toBe("\u00e9clair export");
    const second = createIdea(store, "\u00e9clair export", false);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.warning).toMatch(/i-0001/);
  });

  test("weekly does not reuse the dispatch warning", () => {
    const store = tempStore();
    const open = process.env.FOUNDRY_OPEN_DRAFTS;
    const probe = process.env.FOUNDRY_DRAFT_PROBE;
    delete process.env.FOUNDRY_OPEN_DRAFTS;
    process.env.FOUNDRY_DRAFT_PROBE = "offline";
    try {
      const result = weekly(store, "2026-10-24");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warning).toBe(WEEKLY_DRAFT_WARNING);
      expect(result.warning).not.toMatch(/Dispatch is continuing/);
    } finally {
      if (open === undefined) delete process.env.FOUNDRY_OPEN_DRAFTS;
      else process.env.FOUNDRY_OPEN_DRAFTS = open;
      if (probe === undefined) delete process.env.FOUNDRY_DRAFT_PROBE;
      else process.env.FOUNDRY_DRAFT_PROBE = probe;
    }
  });
});
