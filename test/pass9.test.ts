import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { acceptIntake, ensureDraftDay } from "../scripts/accept-draft-day.js";
import { approve, createIdea, decompose, dispatch, gate, ingest, restate, weekly } from "../src/commands.js";
import { DomainError, parseTitle } from "../src/domain.js";
import { draftBacklogFromGh } from "../src/draft-backlog.js";
import { parseImportFile } from "../src/import-notes.js";
import { FixturePlanner } from "../src/planner.js";
import { startServer } from "../src/server.js";
import { quarantineWarning, Store } from "../src/store.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();
const pr = "https://github.com/example-org/demo-board/pull/9";

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

function report(verdict: "verified" | "rejected"): string {
  return ["---", `verdict: ${verdict}`, "draft: true", `pr: ${pr}`, "---", "", "Synthetic note."].join("\n");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(path, out);
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

function hasGitDir(dir: string): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") return true;
    if (entry.isDirectory() && hasGitDir(join(dir, entry.name))) return true;
  }
  return false;
}

describe("pass 9", () => {
  test("Draft Day is downloaded as a tarball and the tree has no git directory", () => {
    for (const file of [...walkTs("scripts"), ...walkTs("src"), ...walkTs("test")]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bgit\s+(clone|fetch|init|checkout)\b/);
    }
    const source = readFileSync("scripts/accept-draft-day.ts", "utf8");
    expect(source).toMatch(/tarball/);
    expect(source).toMatch(/codeload\.github\.com/);
    const root = ensureDraftDay();
    expect(existsSync(join(root, "src/cli/dd.ts"))).toBe(true);
    expect(hasGitDir(join(process.cwd(), "vendor"))).toBe(false);
    expect(readFileSync(join(root, ".foundry-sha"), "utf8").trim()).toMatch(/^fa266c2/);
  }, 180_000);

  test("recovery rebuilds a parseable intake line for a dispatched spec and Draft Day accepts it", () => {
    const { store, specs } = stack();
    const bottom = specs()[0];
    if (!bottom) throw new Error("missing spec");
    expect(bottom.id).toBe("s-0001-1");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    const intake = join(store.root, "intake.jsonl");
    writeFileSync(intake, '{"ts":"2026-');
    const reopened = new Store(store.root, () => "2026-01-01T00:00:00.000Z");
    reopened.load();
    const text = readFileSync(intake, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.trim().split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as { idea: string; source: string; n: number };
    const packet = JSON.parse(readFileSync(join(store.root, "packets", "s-0001-1.json"), "utf8")) as { intake: typeof parsed };
    expect(parsed).toEqual(packet.intake);
    expect(reopened.readIntake()).toEqual([packet.intake]);
    reopened.load();
    expect(readFileSync(intake, "utf8").trim().split("\n")).toHaveLength(1);
    const accepted = acceptIntake(intake);
    expect(accepted.status).toBe("intake");
    expect(accepted.pickId).toMatch(/^p-/);
  }, 180_000);

  test("a torn intake tail is quarantined and readIntake stays parseable for Draft Day", () => {
    const { store, specs } = stack("weather widget");
    const bottom = specs()[0];
    if (!bottom) throw new Error("missing spec");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    const intake = join(store.root, "intake.jsonl");
    const good = readFileSync(intake, "utf8");
    writeFileSync(intake, `${good}{"ts":"2026-`);
    expect(() => store.readIntake()).not.toThrow();
    const repaired = readFileSync(intake, "utf8");
    expect(repaired).toBe(good.endsWith("\n") ? good : `${good}\n`);
    for (const line of repaired.trim().split("\n")) JSON.parse(line);
    expect(readFileSync(`${intake}.torn`, "utf8")).toMatch(/2026-/);
    const counts = store.quarantineCounts();
    expect(counts.intake).toBeGreaterThan(0);
    const accepted = acceptIntake(intake);
    expect(accepted.status).toBe("intake");
  }, 180_000);

  test("emoji joiner sequences are titles and a bare joiner is still rejected", () => {
    expect(parseTitle("👨‍👩‍👧 family planner")).toBe("👨‍👩‍👧 family planner");
    expect(parseTitle("👨\uFE0F\u200D👩 planner")).toBe("👨\uFE0F\u200D👩 planner");
    expect(() => parseTitle("zero\u200Dwidth")).toThrow(/zero-width/);
    expect(() => parseTitle("habit\u200Btracker")).toThrow(/zero-width|control|bidi/);
    expect(() => parseTitle("habit\u200Ctracker")).toThrow(/zero-width|control|bidi/);
    expect(() => parseTitle("habit\u202Etracker")).toThrow(/bidi|control|zero-width/);
  });

  test("health and weekly report quarantined lines", () => {
    const store = tempStore();
    expect(createIdea(store, "palette mixer", false).ok).toBe(true);
    const events = join(store.root, "events.jsonl");
    writeFileSync(events, `${readFileSync(events, "utf8")}{"at":"202`);
    const reopened = new Store(store.root, () => "2026-01-01T00:00:00.000Z");
    reopened.load();
    const counts = reopened.quarantineCounts();
    expect(counts.events).toBeGreaterThan(0);
    expect(quarantineWarning(counts)).toMatch(/Quarantined lines/);
    const digest = weekly(reopened, "2026-10-24");
    expect(digest.ok).toBe(true);
    if (!digest.ok) return;
    expect(digest.warning).toMatch(/Quarantined lines/);
    expect((digest.data as { quarantined: { events: number } }).quarantined.events).toBe(counts.events);
  });

  test("a bookmark export without --from names the flag", () => {
    const text = JSON.stringify({
      bookmarks: [{ id: "bk-1", author: "synthetic-author", text: "Synthetic card.", date: "2026-10-20" }],
    });
    expect(() => parseImportFile(text)).toThrow(DomainError);
    try {
      parseImportFile(text);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      if (error instanceof DomainError) {
        expect(error.code).toBe("bad_import");
        expect(error.message).toMatch(/foundry import --from/);
        expect(error.message).not.toMatch(/2 to 200/);
      }
    }
    expect(parseImportFile(JSON.stringify({ bookmarks: [{ title: "habit tracker export", note: "A note." }] }))).toEqual([
      { title: "habit tracker export", note: "A note." },
    ]);
  });

  test("a non-numeric draft count is not described as unreachable", () => {
    const answered = draftBacklogFromGh({ status: 0, stdout: "none\n" });
    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.warning).toMatch(/not a number/);
      expect(answered.warning).not.toMatch(/unreachable/);
    }
    const down = draftBacklogFromGh({ error: new Error("spawn"), status: null, stdout: "" });
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.warning).toMatch(/unreachable/);
    expect(draftBacklogFromGh({ status: 0, stdout: "4\n" })).toEqual({ ok: true, drafts: 4 });
  });

  test("a mixed idea is in progress on the state and health payloads", async () => {
    const { store, id, specs } = stack("outline export");
    const family = specs();
    const [bottom, second] = family;
    if (!bottom || !second) throw new Error("missing specs");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    expect(ingest(store, bottom.id, report("verified"), { pr, probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    expect(dispatch(store, second.id, false).ok).toBe(true);
    expect(store.findIdea(id)?.state).toBe("gated");
    const saved = readFileSync(join(store.root, "state.json"), "utf8");
    expect(saved).not.toContain("specCounts");
    expect(saved).not.toContain("in progress");
    const running = await startServer({ store, port: 0 });
    try {
      const state = (await (await fetch(`${running.url}/api/state`)).json()) as {
        ideas: { id: string; state: string; rollup: string; specCounts: { gated: number; dispatched: number; verified: number; rejected: number } }[];
      };
      const idea = state.ideas.find((item) => item.id === id);
      expect(idea?.state).toBe("gated");
      expect(idea?.rollup).toBe("in progress");
      expect(idea?.specCounts.verified).toBe(1);
      expect(idea?.specCounts.dispatched).toBe(1);
      expect(idea?.specCounts.gated).toBeGreaterThan(0);
      expect(idea?.specCounts.rejected).toBe(0);
      const health = (await (await fetch(`${running.url}/api/health`)).json()) as {
        pipeline: {
          ideasInProgress: number;
          ideaRollups: { id: string; rollup: string; specCounts: { verified: number; dispatched: number } }[];
        };
        quarantined: { events: number; ideas: number; lessons: number; intake: number };
      };
      const roll = health.pipeline.ideaRollups.find((item) => item.id === id);
      expect(roll?.rollup).toBe("in progress");
      expect(roll?.specCounts.verified).toBe(1);
      expect(roll?.specCounts.dispatched).toBe(1);
      expect(health.pipeline.ideasInProgress).toBe(1);
      expect(health.quarantined).toEqual({ events: 0, ideas: 0, lessons: 0, intake: 0 });
    } finally {
      await new Promise((resolve) => running.server.close(() => resolve(null)));
    }
  });
});
