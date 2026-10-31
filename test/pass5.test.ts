import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { correct, dispatch, gate, importBookmarks, noteFinding, seedDemo, weekly } from "../src/commands.js";
import { OFFLINE_DRAFT_WARNING } from "../src/draft-backlog.js";
import { weeklyDigest } from "../src/health.js";
import { LESSON_CHECKS } from "../src/lesson-checks.js";
import { FixturePlanner } from "../src/planner.js";
import { approve, createIdea, decompose, restate } from "../src/commands.js";
import { writeDemoGif } from "../scripts/record-demo.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();

function runCli(dir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli.ts", "--data", dir, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: out.status, json: JSON.parse(out.stdout) as { ok: boolean; idempotent?: boolean; data?: Record<string, unknown>; status?: number; next?: string; warning?: string; error?: string } };
}

function ready(title: string) {
  const store = tempStore();
  const made = createIdea(store, title, false);
  if (!made.ok) throw new Error("create");
  const id = (made.data as { id: string }).id;
  restate(store, id, planner, false);
  approve(store, id, "Ship the smallest slice", false);
  decompose(store, id, planner, false);
  const gated = gate(store, id, false);
  if (!gated.ok) throw new Error(JSON.stringify(gated));
  return store;
}

describe("pass 5", () => {
  test("a repeated finding writes one idempotent proposal", () => {
    const store = tempStore();
    expect(noteFinding(store, "g2:vague-verb", "Replace the vague verb.").ok).toBe(true);
    expect(noteFinding(store, "g2:vague-verb", "Replace the vague verb.").ok).toBe(true);
    const first = correct(store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const proposals = (first.data as { proposals: { path: string; gate: string }[] }).proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.gate).toBe("G2");
    const body = readFileSync(proposals[0]?.path ?? "", "utf8");
    expect(body).toContain("Gate: G2");
    expect(body).toContain("throw new Error");
    const again = correct(store);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.idempotent).toBe(true);
    expect(readdirSync(join(store.root, "lessons", "proposals"))).toHaveLength(1);
  });

  test("an unenforced lesson fails the gate until it is a check", () => {
    expect(LESSON_CHECKS["g2:vague-verb"]).toBeTypeOf("function");
    const store = ready("palette mixer");
    expect(noteFinding(store, "g2:brand-new-rule", "Encode the repeated miss.").ok).toBe(true);
    expect(noteFinding(store, "g2:brand-new-rule", "Encode the repeated miss.").ok).toBe(true);
    const id = store.load().ideas[0]?.id ?? "";
    const gated = gate(store, id, false);
    expect(gated.ok).toBe(true);
    const specs = store.load().specs.filter((spec) => spec.ideaId === id);
    expect(specs.every((spec) => spec.state === "specced")).toBe(true);
    expect(specs.some((spec) => spec.gates.some((item) => item.findings.some((finding) => finding.key === "g0:unenforced-lesson")))).toBe(true);
  });

  test("importing the same bookmark file twice adds nothing the second time", () => {
    const store = tempStore();
    const text = readFileSync("fixtures/x-bookmarks.json", "utf8");
    const first = importBookmarks(store, text, planner, false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toMatchObject({ count: 2 });
    const second = importBookmarks(store, text, planner, false);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data).toMatchObject({ count: 0 });
    expect(store.load().ideas).toHaveLength(2);
    const dir = mkdtempSync(join(tmpdir(), "foundry-bookmarks-"));
    expect(runCli(dir, ["import", "--from", "fixtures/x-bookmarks.json"]).json.ok).toBe(true);
    const again = runCli(dir, ["import", "--from", "fixtures/x-bookmarks.json"]).json;
    expect(again.ok).toBe(true);
    expect(again.data).toMatchObject({ count: 0 });
  });

  test("weekly prints counts for the seed board", () => {
    const dir = mkdtempSync(join(tmpdir(), "foundry-weekly-"));
    expect(runCli(dir, ["seed"]).json.ok).toBe(true);
    const report = runCli(dir, ["weekly", "--since", "2026-10-24"]).json;
    expect(report.ok).toBe(true);
    const data = report.data as { since: string; ideasMoved: number; specsVerified: number; openDraftPrs: number; staleDispatched: number };
    expect(data.since).toBe("2026-10-24");
    expect(data.ideasMoved).toBeGreaterThan(0);
    expect(data.specsVerified).toBe(0);
    expect(data.openDraftPrs).toBe(0);
    expect(data.staleDispatched).toBe(0);
    const stale = weeklyDigest(
      {
        ideas: [],
        specs: [
          { state: "dispatched", updatedAt: "2026-01-01T00:00:00.000Z" },
          { state: "verified", updatedAt: "2026-10-20T00:00:00.000Z", draft: true },
        ],
      },
      "2026-10-24",
    );
    expect(stale.staleDispatched).toBe(1);
    expect(stale.openDraftPrs).toBe(1);
    expect(stale.specsVerified).toBe(0);
    const store = tempStore();
    expect(seedDemo(store, planner).ok).toBe(true);
    expect(weekly(store, "2026-10-24").ok).toBe(true);
  });

  test("dispatch refuses 16 open drafts and continues when GitHub is offline", () => {
    const store = ready("trivia scoring");
    const spec = store.load().specs.find((item) => item.index === 1);
    if (!spec) throw new Error("missing spec");
    const refused = dispatch(store, spec.id, false, undefined, () => ({ ok: true, drafts: 16 }));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.status).toBe(409);
    expect(refused.error).toBe("draft_backlog");
    expect(refused.next).toMatch(/foundry dispatch/);
    expect(store.findSpec(spec.id)?.state).toBe("gated");
    const offline = dispatch(store, spec.id, false, undefined, () => ({ ok: false, warning: OFFLINE_DRAFT_WARNING }));
    expect(offline.ok).toBe(true);
    if (!offline.ok) return;
    expect(offline.warning).toMatch(/unreachable/);
    expect(store.findSpec(spec.id)?.state).toBe("dispatched");
  });

  test("tlc prints a skip when java is not on PATH", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: "/tmp/foundry-no-java" };
    delete env.CI;
    delete env.GITHUB_ACTIONS;
    const ran = spawnSync(process.execPath, ["scripts/tlc.mjs"], { encoding: "utf8", env });
    expect(ran.status).toBe(0);
    expect(`${ran.stderr}`).toMatch(/SKIP: Java is not on PATH/);
  });

  test("pii scan names the missing tool and the JDK prerequisite", () => {
    const env = { ...process.env, PATH: "/tmp/foundry-no-tools" };
    const ran = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/pii-scan.ts"], { encoding: "utf8", env });
    expect(ran.status).toBe(1);
    expect(ran.stdout).toMatch(/tesseract/);
    expect(ran.stdout).toMatch(/JDK 21/);
    expect(ran.stdout).toMatch(/README Prerequisites/);
  });

  test("writeDemoGif rebuilds a gif from a video without touching the committed demo", () => {
    const dir = mkdtempSync(join(tmpdir(), "foundry-gif-"));
    const video = join(dir, "clip.webm");
    const gif = join(dir, "clip.gif");
    const made = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.2", "-pix_fmt", "yuv420p", video], { encoding: "utf8" });
    expect(made.status).toBe(0);
    writeDemoGif(video, gif);
    expect(readFileSync(gif).subarray(0, 3).toString("ascii")).toBe("GIF");
    expect(readFileSync("screenshots/demo.gif").subarray(0, 3).toString("ascii")).toBe("GIF");
  });
});
