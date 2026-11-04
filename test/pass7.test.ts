import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "vitest";
import { approve, createIdea, decompose, dispatch, gate, importBookmarks, ingest, restate } from "../src/commands.js";
import { interpretGithubProbe } from "../src/draft-status.js";
import { parseBookmarkExport, parseImportFile } from "../src/import-notes.js";
import { FixturePlanner } from "../src/planner.js";
import { startServer } from "../src/server.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();
const pr = "https://github.com/example-org/demo-board/pull/4";

function report(verdict: "verified" | "rejected", draft: boolean, body = "Synthetic note."): string {
  return ["---", `verdict: ${verdict}`, `draft: ${draft}`, `pr: ${pr}`, "---", "", body].join("\n");
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
  if (!dispatch(store, spec.id, false).ok) throw new Error("dispatch");
  return { store, id, specId: spec.id };
}

function withGh(body: string | null, run: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "foundry-gh-"));
  if (body !== null) {
    const path = join(dir, "gh");
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  }
  const previous = process.env.PATH;
  const mode = process.env.FOUNDRY_GITHUB_DRAFT;
  delete process.env.FOUNDRY_GITHUB_DRAFT;
  process.env.PATH = body === null ? dir : `${dir}${delimiter}${previous ?? ""}`;
  try {
    run();
  } finally {
    process.env.PATH = previous;
    if (mode === undefined) delete process.env.FOUNDRY_GITHUB_DRAFT;
    else process.env.FOUNDRY_GITHUB_DRAFT = mode;
  }
}

describe("pass 7", () => {
  test("network loss, a missing gh, a hang, and a non-JSON body stay dispatched", () => {
    const cases: { name: string; body: string | null }[] = [
      { name: "network", body: "#!/bin/sh\necho 'dial tcp: network is unreachable' >&2\nexit 1\n" },
      { name: "missing", body: null },
      { name: "hang", body: "#!/bin/sh\nsleep 30\n" },
      { name: "html", body: "#!/bin/sh\necho '<html><body>nope</body></html>'\nexit 0\n" },
    ];
    for (const item of cases) {
      const { store, specId } = dispatched(`${item.name} widget card`);
      const version = store.findSpec(specId)?.version;
      withGh(item.body, () => {
        const result = ingest(store, specId, report("verified", true), { pr }, false);
        expect(result.ok, item.name).toBe(false);
        if (result.ok) return;
        expect(result.error, item.name).toBe("github_unconfirmed");
        expect(result.status, item.name).toBe(503);
        expect(result.confirmation, item.name).toBe("unconfirmed");
        expect(result.next, item.name).toMatch(/--recheck/);
      });
      expect(store.findSpec(specId)?.state, item.name).toBe("dispatched");
      expect(store.findSpec(specId)?.version, item.name).toBe(version);
    }
  }, 60_000);

  test("re-ingest of a verified spec does not downgrade or bump the version", () => {
    const { store, specId } = dispatched("palette mixer");
    expect(ingest(store, specId, report("verified", true), { pr, probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    const version = store.findSpec(specId)?.version;
    const same = ingest(store, specId, report("verified", true), { pr, probe: () => ({ ok: true, draft: false }) }, false);
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.idempotent).toBe(true);
    expect(store.findSpec(specId)?.state).toBe("verified");
    expect(store.findSpec(specId)?.version).toBe(version);
    const changed = ingest(store, specId, report("verified", false), { pr, probe: () => ({ ok: true, draft: false }) }, false);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error).toBe("already_final");
    expect(store.findSpec(specId)?.state).toBe("verified");
    expect(store.findSpec(specId)?.version).toBe(version);
    const explicit = ingest(store, specId, report("verified", false), { pr, unverify: true, probe: () => ({ ok: true, draft: false }) }, false);
    expect(explicit.ok).toBe(true);
    expect(store.findSpec(specId)?.state).toBe("dispatched");
  });

  test("idea state rolls up and the health mean fills in", async () => {
    const { store, id, specId } = dispatched("outline export");
    const specs = store.load().specs.filter((spec) => spec.ideaId === id).sort((a, b) => a.index - b.index);
    for (const spec of specs) {
      if (spec.id !== specId) expect(dispatch(store, spec.id, false).ok).toBe(true);
      expect(ingest(store, spec.id, report("verified", true), { pr, probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    }
    expect(store.findIdea(id)?.state).toBe("verified");
    const events = readFileSync(join(store.root, "events.jsonl"), "utf8");
    expect(events).toContain(`"id":"${specId}"`);
    expect(events).toContain('"state":"verified"');
    const running = await startServer({ store, port: 0 });
    try {
      const health = (await (await fetch(`${running.url}/api/health`)).json()) as {
        pipeline: { ideasByState: { verified: number }; meanMinutesIdeaToVerified: number | null };
      };
      expect(health.pipeline.ideasByState.verified).toBe(1);
      expect(health.pipeline.meanMinutesIdeaToVerified).not.toBeNull();
    } finally {
      await new Promise((resolve) => running.server.close(() => resolve(null)));
    }
  });

  test("a rejected spec rolls the idea up to rejected", () => {
    const { store, id, specId } = dispatched("weather widget");
    const rejected = ingest(store, specId, report("rejected", true, "Tests failed: flaky timer"), { pr, probe: () => ({ ok: true, draft: true }) }, false);
    expect(rejected.ok).toBe(true);
    expect(store.findSpec(specId)?.state).toBe("rejected");
    expect(store.findIdea(id)?.state).toBe("rejected");
  });

  test("three thousand bookmarks import, and a second pass adds nothing", () => {
    const store = tempStore();
    const bookmarks = Array.from({ length: 3000 }, (_, index) => ({
      id: `bk-${index}`,
      author: "synthetic-author",
      text: `Synthetic palette card ${index}.`,
      date: "2026-10-20",
    }));
    const text = JSON.stringify({ bookmarks });
    const first = importBookmarks(store, text, planner, false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toMatchObject({ count: 3000 });
    const second = importBookmarks(store, text, planner, false);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ count: 0 });
    expect(second.idempotent).toBe(true);
    expect(store.load().ideas).toHaveLength(3000);
  }, 180_000);

  test("a 3 MB binary fails JSON parsing and a BOM-prefixed file imports", () => {
    const binary = "x".repeat(3_000_000);
    expect(() => parseBookmarkExport(binary)).toThrow(/not valid JSON/);
    expect(() => parseBookmarkExport(binary)).not.toThrow(/too large/);
    const bom = `\uFEFF${JSON.stringify({
      bookmarks: [{ id: "bk-bom", author: "synthetic-author", text: "Show a bom safe card.", date: "2026-10-20" }],
    })}`;
    expect(parseBookmarkExport(bom).rows).toHaveLength(1);
    expect(parseImportFile(`\uFEFF{"notes":[{"title":"trivia scoring","note":"Score a synthetic round."}]}`)).toEqual([
      { title: "trivia scoring", note: "Score a synthetic round." },
    ]);
  });

  test("403 is 403, an all-invalid import is not idempotent, and the duplicate warning names the idea", () => {
    const { store, specId } = dispatched("habit tracker export");
    const forbidden = ingest(store, specId, report("verified", true), {
      pr,
      probe: () => interpretGithubProbe({ status: 1, stdout: "", stderr: "gh: Forbidden (HTTP 403)" }),
    }, false);
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) {
      expect(forbidden.status).toBe(403);
      expect(forbidden.error).toBe("probe_auth");
    }
    const bad = importBookmarks(store, JSON.stringify({ bookmarks: [{ id: "b5", text: "" }, { text: "" }] }), planner, false);
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.data).toMatchObject({ count: 0, invalid: 2 });
    expect(bad.idempotent).toBeUndefined();
    const dup = createIdea(store, "habit tracker export", false);
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    expect(dup.warning).toMatch(/i-0001/);
    expect(dup.warning).toMatch(/habit tracker export/);
  });
});
