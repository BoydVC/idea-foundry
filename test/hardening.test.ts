import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { approve, createIdea, decompose, dispatch, gate, ingest, restate } from "../src/commands.js";
import { version, type Idea, type Spec } from "../src/domain.js";
import { type DraftProbeResult } from "../src/draft-status.js";
import { checkG1, sharedTouchFindings } from "../src/gates.js";
import { parseImportFile } from "../src/import-notes.js";
import { FixturePlanner } from "../src/planner.js";
import { startServer } from "../src/server.js";
import { tempStore } from "./helpers.js";

const RATE_LIMIT_WARNING = "GitHub API rate limit reached. Not using the report line.";
const planner = new FixturePlanner();
const pr = "https://github.com/example-org/demo-board/pull/4";
const otherPr = "https://github.com/example-org/demo-board/pull/99";

function report(draft: boolean, pull = pr): string {
  return ["---", "verdict: verified", `draft: ${draft}`, `pr: ${pull}`, "---", "", "Synthetic note."].join("\n");
}

function spawnRacer(dir: string, mark: string, holdMs: number, id: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "test/support/lock-racer.ts", dir, mark, String(holdMs), id],
      { cwd: process.cwd() },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function waitForLock(dir: string): Promise<void> {
  const lock = join(dir, "state.lock");
  const started = Date.now();
  while (!existsSync(lock)) {
    if (Date.now() - started > 3000) throw new Error("lock did not appear");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function ready(title: string) {
  const store = tempStore();
  const made = createIdea(store, title, false);
  if (!made.ok) throw new Error(made.message);
  const id = (made.data as Idea).id;
  if (!restate(store, id, planner, false).ok) throw new Error("restate");
  if (!approve(store, id, "Ship the smallest slice", false).ok) throw new Error("approve");
  if (!decompose(store, id, planner, false).ok) throw new Error("decompose");
  const gated = gate(store, id, false);
  if (!gated.ok) throw new Error(JSON.stringify(gated));
  const specs = () => store.load().specs.filter((spec) => spec.ideaId === id).sort((a, b) => a.index - b.index);
  return { store, id, specs };
}

describe("hardening", () => {
  test("a slow holder does not lose a concurrent label write", async () => {
    const store = tempStore();
    const made = createIdea(store, "habit tracker export", false);
    if (!made.ok) throw new Error(made.message);
    const id = (made.data as Idea).id;
    const holder = spawnRacer(store.root, "holder", 5600, id);
    await waitForLock(store.root);
    const racer = await spawnRacer(store.root, "racer", 0, id);
    const held = await holder;
    expect(held.code, held.stderr + held.stdout).toBe(0);
    expect(racer.code, racer.stderr + racer.stdout).toBe(0);
    expect(store.findIdea(id)?.labels).toEqual(["holder", "racer"]);
  }, 20_000);

  test("dashboard and cli creates do not share an idea id", async () => {
    const store = tempStore();
    const running = await startServer({ store, port: 0 });
    try {
      const results = await Promise.allSettled([
        ...Array.from({ length: 6 }, (_, index) =>
          fetch(`${running.url}/api/idea`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: `weather slice ${index}` }),
          }).then(async (response) => {
            const body = (await response.json()) as { ok: boolean };
            if (!body.ok) throw new Error(JSON.stringify(body));
          }),
        ),
        ...Array.from({ length: 6 }, (_, index) => {
          const child = spawn(
            process.execPath,
            ["node_modules/tsx/dist/cli.mjs", "src/cli.ts", "--data", store.root, "idea", `trivia slice ${index}`],
            { cwd: process.cwd() },
          );
          return new Promise<void>((resolve, reject) => {
            let stdout = "";
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
              stdout += chunk;
            });
            child.on("error", reject);
            child.on("close", (code) => {
              if (code !== 0) reject(new Error(stdout));
              else resolve();
            });
          });
        }),
      ]);
      const failed = results.filter((item) => item.status === "rejected");
      expect(failed).toEqual([]);
      const ids = store.load().ideas.map((idea) => idea.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(12);
      expect(store.load().nextIdea).toBe(13);
    } finally {
      await new Promise((resolve) => running.server.close(() => resolve(null)));
    }
  });

  test("a string version cannot approve a newer idea", async () => {
    const store = tempStore();
    const made = createIdea(store, "weather widget", false);
    if (!made.ok) throw new Error(made.message);
    const id = (made.data as Idea).id;
    expect(restate(store, id, planner, false).ok).toBe(true);
    const running = await startServer({ store, port: 0 });
    try {
      const response = await fetch(`${running.url}/api/idea/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "Ship the smallest slice", version: "1" }),
      });
      const body = (await response.json()) as { ok: boolean; status?: number; error?: string };
      expect(body.ok).toBe(false);
      expect(body.status).toBe(400);
      expect(store.findIdea(id)?.state).toBe("restated");
    } finally {
      await new Promise((resolve) => running.server.close(() => resolve(null)));
    }
  });

  test("malformed imports are rejected instead of coerced", () => {
    expect(() => parseImportFile(JSON.stringify({ bookmarks: [{ title: "habit tracker export", note: 12 }] }))).toThrow(/note/);
    expect(() => parseImportFile(JSON.stringify({ bookmarks: "habit tracker export" }))).toThrow(/bookmarks/);
    expect(() => parseImportFile(JSON.stringify({ notes: null }))).toThrow(/notes/);
    expect(parseImportFile("{draft}\n\n# trivia scoring\n\nScore a round of synthetic quiz answers.\n")).toEqual([
      { title: "trivia scoring", note: "Score a round of synthetic quiz answers." },
    ]);
    const huge = JSON.stringify({ bookmarks: [{ title: "habit tracker export", note: "n".repeat(20_000) }] });
    expect(() => parseImportFile(huge)).toThrow(/too large/);
  });

  test("percent-encoded and lookalike touch paths cannot leave the repo or hide a shared file", () => {
    const good = {
      acceptance: ["node --test src/widget/model.test.ts"],
      touch: ["src/%2e%2e/%2e%2e/etc/passwd"],
      maxLines: 80,
    };
    expect(checkG1(good).findings.some((item) => item.key === "g1:touch-escape")).toBe(true);
    expect(
      checkG1({ ...good, touch: ["\uFF0E\uFF0E/\uFF0E\uFF0E/etc/passwd"] }).findings.some((item) => item.key === "g1:touch-escape"),
    ).toBe(true);
    expect(checkG1({ ...good, touch: ["C:/synthetic/widget.ts"] }).findings.some((item) => item.key === "g1:touch-escape")).toBe(true);
    expect(
      checkG1({ ...good, acceptance: ['node --test src/widget/model.test.ts && node -e "process.exit(0)"'], touch: ["src/widget/model.ts"] })
        .findings.some((item) => item.key === "g1:acceptance"),
    ).toBe(true);
    expect(
      sharedTouchFindings(
        { id: "s-0001-2", touch: ["src/widget/./model.ts"] },
        [{ id: "s-0001-1", touch: ["src/widget/model.ts"] }],
      ),
    ).toEqual([{ key: "g1:blast", detail: "src/widget/model.ts is also touched by s-0001-1.", proof: 2 }]);
  });

  test("a normalized alias of a shared touch path fails the gate", () => {
    const { store, id, specs } = ready("outline export");
    const family = specs();
    const bottom = family[0];
    const upper = family[1];
    if (!bottom || !upper) throw new Error("missing specs");
    const file = bottom.touch[0];
    if (!file) throw new Error("missing touch");
    const alias = file.replace(/\/([^/]+)$/, "/./$1");
    const wrote = store.transact({ ideas: [], specs: [{ id: upper.id, version: upper.version }] }, (snap) => ({
      ...snap,
      specs: snap.specs.map((spec) =>
        spec.id === upper.id ? { ...spec, touch: [alias], version: version(spec.version + 1) } : spec,
      ),
    }));
    expect(wrote.ok).toBe(true);
    const gated = gate(store, id, false);
    expect(gated.ok).toBe(true);
    const after = store.load().specs.filter((spec) => spec.ideaId === id);
    const flagged = after.filter((spec) => spec.gates.some((item) => item.findings.some((finding) => finding.key === "g1:blast")));
    expect(flagged.map((spec) => spec.id).sort()).toEqual([bottom.id, upper.id].sort());
    expect(store.findIdea(id)?.state).toBe("specced");
  }, 60_000);

  test("github rate limits do not verify from the report line", () => {
    const { store, specs } = ready("trivia scoring");
    const bottom = specs()[0];
    if (!bottom) throw new Error("missing spec");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    const limited = ingest(
      store,
      bottom.id,
      report(true),
      {
        probe: () =>
          ({
            ok: false,
            warning: RATE_LIMIT_WARNING,
            trustReport: false,
          }) as DraftProbeResult,
      },
      false,
    );
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.status).toBe(429);
    expect(store.findSpec(bottom.id)?.state).toBe("dispatched");
  }, 60_000);

  test("a different pull request url cannot un-verify a spec", () => {
    const { store, specs } = ready("palette mixer");
    const bottom = specs()[0];
    if (!bottom) throw new Error("missing spec");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    expect(ingest(store, bottom.id, report(true), { probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    let probed = false;
    const mismatch = ingest(
      store,
      bottom.id,
      report(false, otherPr),
      {
        pr: otherPr,
        probe: () => {
          probed = true;
          return { ok: true, draft: false, closed: true };
        },
      },
      false,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error).toBe("pr_mismatch");
    expect(probed).toBe(false);
    expect(store.findSpec(bottom.id)?.state).toBe("verified");
  }, 60_000);

  test("un-verify during the github probe cannot leave a higher spec verified", () => {
    const { store, id, specs } = ready("weather widget");
    const family = specs();
    const bottom = family[0];
    const upper = family[1];
    if (!bottom || !upper) throw new Error("missing specs");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    expect(ingest(store, bottom.id, report(true), { probe: () => ({ ok: true, draft: true }) }, false).ok).toBe(true);
    expect(dispatch(store, upper.id, false).ok).toBe(true);
    const raced = ingest(
      store,
      upper.id,
      report(true),
      {
        probe: () => {
          const dropped = ingest(store, bottom.id, report(false), { probe: () => ({ ok: true, draft: false }) }, false);
          if (!dropped.ok) throw new Error(JSON.stringify(dropped));
          return { ok: true, draft: true };
        },
      },
      false,
    );
    expect(raced.ok).toBe(false);
    if (!raced.ok) expect(raced.error).toBe("stack_order");
    expect(store.findSpec(bottom.id)?.state).toBe("dispatched");
    expect(store.findSpec(upper.id)?.state).toBe("dispatched");
    expect(store.findIdea(id)?.state).not.toBe("verified");
    const saved = store.load().specs.filter((spec) => spec.ideaId === id);
    const verified = saved.filter((spec) => spec.state === "verified");
    const lowestVerified = verified.reduce<Spec | undefined>((min, spec) => (min === undefined || spec.index < min.index ? spec : min), undefined);
    if (lowestVerified) {
      expect(saved.filter((spec) => spec.index < lowestVerified.index).every((spec) => spec.state === "verified")).toBe(true);
    }
  }, 60_000);

  test("a middle spec stays verified until the spec above it leaves", () => {
    const { store, id, specs } = ready("habit tracker export");
    const prFor = (index: number) => `https://github.com/example-org/demo-board/pull/${index}`;
    for (const spec of specs()) {
      expect(dispatch(store, spec.id, false).ok).toBe(true);
      expect(
        ingest(store, spec.id, report(true, prFor(spec.index)), { probe: () => ({ ok: true, draft: true }) }, false).ok,
      ).toBe(true);
    }
    const family = specs();
    expect(family.length).toBeGreaterThanOrEqual(3);
    const middle = family[1];
    if (!middle) throw new Error("missing middle");
    const blocked = ingest(store, middle.id, report(false, prFor(middle.index)), { probe: () => ({ ok: true, draft: false }) }, false);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("stack_order");
    expect(store.findSpec(middle.id)?.state).toBe("verified");
    expect(store.findIdea(id)?.state).toBe("verified");
  }, 60_000);
});
