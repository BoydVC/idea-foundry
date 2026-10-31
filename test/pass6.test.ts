import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { approve, correct, createIdea, decompose, dispatch, gate, importBookmarks, ingest, rejectionKey, restate, seedDemo } from "../src/commands.js";
import { normalizeTitle } from "../src/domain.js";
import { interpretGithubProbe, PR_NOT_FOUND_WARNING } from "../src/draft-status.js";
import { pipelineHealth } from "../src/health.js";
import { FixturePlanner } from "../src/planner.js";
import { startServer } from "../src/server.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();
const pr = "https://github.com/example-org/demo-board/pull/4";

function report(verdict: "verified" | "rejected", draft: boolean, pull = pr, body = "Synthetic note."): string {
  return ["---", `verdict: ${verdict}`, `draft: ${draft}`, `pr: ${pull}`, "---", "", body].join("\n");
}

function dispatched(title = "trivia scoring") {
  const store = tempStore();
  const made = createIdea(store, title, false);
  if (!made.ok) throw new Error("create");
  const id = (made.data as { id: string }).id;
  restate(store, id, planner, false);
  approve(store, id, "Ship the smallest slice", false);
  decompose(store, id, planner, false);
  const gated = gate(store, id, false);
  if (!gated.ok) throw new Error(JSON.stringify(gated));
  const spec = store.load().specs.find((item) => item.ideaId === id && item.index === 1);
  if (!spec) throw new Error("missing spec");
  const sent = dispatch(store, spec.id, false);
  if (!sent.ok) throw new Error(JSON.stringify(sent));
  return { store, id, specId: spec.id };
}

describe("pass 6", () => {
  test("a 404 lookup does not verify a draft from the report", () => {
    const { store, specId } = dispatched();
    const missing = ingest(
      store,
      specId,
      report("verified", true),
      { pr, probe: () => interpretGithubProbe({ status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }) },
      false,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error).toBe("pr_not_found");
    expect(missing.status).toBe(404);
    expect(missing.warning).toBe(PR_NOT_FOUND_WARNING);
    expect(store.findSpec(specId)?.state).toBe("dispatched");
    const offline = ingest(
      store,
      specId,
      report("verified", true),
      { pr, probe: () => interpretGithubProbe({ status: null, stdout: "", stderr: "dial tcp: lookup api.github.com", errorCode: "ENOTFOUND" }) },
      false,
    );
    expect(offline.ok).toBe(true);
    expect(store.findSpec(specId)?.state).toBe("verified");
  });

  test("a --pr that disagrees with the report is a mismatch", () => {
    const { store, specId } = dispatched("weather widget");
    const other = "https://github.com/example-org/demo-board/pull/8";
    const mismatched = ingest(store, specId, report("verified", true, pr), { pr: other, probe: () => ({ ok: true, draft: true }) }, false);
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.error).toBe("pr_mismatch");
    expect(store.findSpec(specId)?.state).toBe("dispatched");
  });

  test("bookmark import skips duplicate text, duplicate titles, and bad rows", () => {
    const store = tempStore();
    expect(createIdea(store, "habit tracker export", false).ok).toBe(true);
    const file = JSON.stringify({
      bookmarks: [
        { id: "bk-card", author: "synthetic-author", text: "Show a palette mixer card.", date: "2026-10-20" },
        { id: "bk-again", author: "synthetic-author", text: "Show a palette mixer card.", date: "2026-10-20" },
        { id: "bk-punct", author: "synthetic-author", text: "  SHOW a palette mixer card!!! ", date: "2026-10-21" },
        { id: "bk-title", author: "synthetic-author", text: "habit tracker export", date: "2026-10-22" },
        { id: "b5", text: "" },
      ],
    });
    const imported = importBookmarks(store, file, planner, false);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const data = imported.data as { count: number; skipped: { index: number; reason: string; message: string; next: string }[] };
    expect(data.count).toBe(1);
    expect(store.load().ideas.map((idea) => idea.title)).toEqual(["habit tracker export", "Show a palette mixer card."]);
    expect(data.skipped.map((item) => item.reason).sort()).toEqual(["duplicate-text", "duplicate-text", "duplicate-title", "invalid-row"]);
    const bad = data.skipped.find((item) => item.reason === "invalid-row");
    expect(bad?.index).toBe(5);
    expect(bad?.message).toMatch(/Row 5/);
    expect(bad?.next).toBe("Add text for that bookmark.");
    expect(bad?.next).not.toMatch(/500/);
  });

  test("normalizeTitle ignores case and punctuation", () => {
    expect(normalizeTitle("  BUILD a Recipe Scaler…!! ")).toBe("build a recipe scaler");
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(normalizeTitle(normalizeTitle(value))).toBe(normalizeTitle(value));
      }),
    );
  });

  test("a rejected ingest becomes a lesson proposal", () => {
    const { store, specId } = dispatched("palette mixer");
    const rejected = ingest(
      store,
      specId,
      report("rejected", true, pr, "Tests failed: flaky timer"),
      { pr, probe: () => ({ ok: true, draft: true }) },
      false,
    );
    expect(rejected.ok).toBe(true);
    expect(store.findSpec(specId)?.state).toBe("rejected");
    const lesson = store.load().lessons[0];
    expect(lesson?.key).toBe(rejectionKey("Tests failed: flaky timer"));
    expect(lesson?.promotedTo).toBe("G3");
    const first = correct(store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const proposals = (first.data as { proposals: { gate: string; path: string }[] }).proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.gate).toBe("G3");
    const again = correct(store);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.idempotent).toBe(true);
  });

  test("health counts verified and rejected specs while the idea stays gated", () => {
    const store = tempStore();
    const health = pipelineHealth({
      ideas: [{ state: "gated", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
      specs: [
        { state: "verified", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:20:00.000Z", gates: [] },
        { state: "rejected", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:10:00.000Z", gates: [] },
      ],
      lessons: [],
    });
    expect(health.ideasByState.gated).toBe(1);
    expect(health.ideasByState.verified).toBe(0);
    expect(health.ideasByState.rejected).toBe(0);
    expect(health.specsVerified).toBe(1);
    expect(health.specsRejected).toBe(1);
    expect(health.meanMinutesIdeaToVerified).toBeNull();
    expect(health.meanMinutesSpecToVerified).toBe(20);
    expect(store.load().ideas).toHaveLength(0);
  });

  test("duplicate titles warn unless --allow-duplicate is set", () => {
    const store = tempStore();
    expect(createIdea(store, "habit tracker export", false).ok).toBe(true);
    const again = createIdea(store, "  Habit tracker export!! ", false);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.warning).toMatch(/already uses the title/);
    expect(store.load().ideas).toHaveLength(2);
    const allowed = createIdea(store, "habit tracker export", false, { allowDuplicate: true });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.warning).toBeUndefined();
  });

  test("seed refuses a store that already has ideas", () => {
    const store = tempStore();
    expect(createIdea(store, "side board widget", false).ok).toBe(true);
    const refused = seedDemo(store, planner);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.status).toBe(409);
    expect(refused.error).toBe("store_not_empty");
    expect(store.load().ideas).toHaveLength(1);
    const replaced = seedDemo(store, planner, { fresh: true });
    expect(replaced.ok).toBe(true);
    expect(store.load().ideas.map((idea) => idea.title)).toContain("habit tracker export");
    expect(store.load().ideas.some((idea) => idea.title === "side board widget")).toBe(false);
  });

  test("POST /api/idea rejects unknown fields, one-character titles, and leaks no parser text", async () => {
    const store = tempStore();
    const running = await startServer({ store, port: 0 });
    try {
      const unknown = await fetch(`${running.url}/api/idea`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "habit tracker export", bogus: 1 }),
      });
      expect(unknown.status).toBe(400);
      const unknownBody = (await unknown.json()) as { message: string };
      expect(unknownBody.message).toBe("The request has an unknown field.");
      expect(store.load().ideas).toHaveLength(0);
      const short = await fetch(`${running.url}/api/idea`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      });
      expect(short.status).toBe(400);
      const broken = await fetch(`${running.url}/api/idea`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(broken.status).toBe(400);
      const brokenBody = (await broken.json()) as { message: string };
      expect(brokenBody.message).toBe("The request body is not valid JSON.");
      expect(brokenBody.message).not.toMatch(/Unexpected|position|JSON\.parse/i);
    } finally {
      await new Promise((resolve) => running.server.close(() => resolve(null)));
    }
  });
});
