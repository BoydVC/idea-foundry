import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildPacket, parsePacket } from "../src/packet.js";
import { FixturePlanner, SEED_TITLES, specCount } from "../src/planner.js";
import { approve, createIdea, decompose, dispatch, gate, ingest, noteFinding, restate, seedDemo } from "../src/commands.js";
import type { Idea, Spec } from "../src/domain.js";
import { startServer } from "../src/server.js";
import { tempStore } from "./helpers.js";

const planner = new FixturePlanner();

function runCli(dir: string, args: string[]) {
  const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli.ts", "--data", dir, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(out) as { ok: boolean; dryRun?: boolean; data?: { state?: string; id?: string }; next?: string; error?: string };
}

describe("foundry flow", () => {
  test("idea, restate, and approve round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "foundry-cli-"));
    const made = runCli(dir, ["idea", "habit tracker export"]);
    expect(made.ok).toBe(true);
    const id = made.data?.id;
    expect(id).toBe("i-0001");
    const restated = runCli(dir, ["restate", id ?? ""]);
    expect(restated.ok).toBe(true);
    expect(restated.data?.state).toBe("restated");
    const approved = runCli(dir, ["approve", id ?? "", "--note", "Ship the smallest slice"]);
    expect(approved.ok).toBe(true);
    expect(approved.data?.state).toBe("approved");
    const again = runCli(dir, ["approve", id ?? "", "--note", "Ship the smallest slice"]);
    expect(again.ok).toBe(true);
  });

  test("dry-run does not write state", () => {
    const store = tempStore();
    const preview = createIdea(store, "weather widget", true);
    expect(preview.ok).toBe(true);
    expect(store.load().ideas).toHaveLength(0);
  });

  test("five seed ideas become at least 14 specs", () => {
    const total = SEED_TITLES.reduce((sum, title) => sum + specCount(title), 0);
    expect(total).toBeGreaterThanOrEqual(14);
    const store = tempStore();
    for (const title of SEED_TITLES) {
      const made = createIdea(store, title, false);
      if (!made.ok) throw new Error(made.message);
      const id = (made.data as Idea).id;
      expect(restate(store, id, planner, false).ok).toBe(true);
      expect(approve(store, id, "Ship the smallest slice", false).ok).toBe(true);
      const stack = decompose(store, id, planner, false);
      expect(stack.ok).toBe(true);
    }
    expect(store.load().specs.length).toBe(total);
    expect(store.load().specs.length).toBeGreaterThanOrEqual(14);
  });

  test("dispatch round-trips a draft intake packet and ingest refuses a published PR", () => {
    const store = tempStore();
    const made = createIdea(store, "trivia scoring", false);
    if (!made.ok) throw new Error("create");
    const id = (made.data as Idea).id;
    restate(store, id, planner, false);
    approve(store, id, "Ship the smallest slice", false);
    const decomposed = decompose(store, id, planner, false);
    if (!decomposed.ok) throw new Error("decompose");
    const gated = gate(store, id, false);
    if (!gated.ok) throw new Error(JSON.stringify(gated));
    const specs = store.load().specs.filter((spec) => spec.ideaId === id);
    const bottom = specs.find((spec) => spec.index === 1);
    const upper = specs.find((spec) => spec.index === 2);
    if (!bottom || !upper) throw new Error("missing specs");
    const sent = dispatch(store, bottom.id, false);
    expect(sent.ok).toBe(true);
    const savedBottom = store.findSpec(bottom.id);
    const packetPath = savedBottom && savedBottom.state === "dispatched" ? savedBottom.packetPath : undefined;
    if (!packetPath) throw new Error("packet path");
    const packet = parsePacket(JSON.parse(readFileSync(packetPath, "utf8")) as unknown);
    expect(packet).toEqual(buildPacket(store.findSpec(bottom.id) as Spec));
    expect(packet.protocol).toBe("dd-intake/v1");
    expect(packet.requiresDraftPr).toBe(true);
    const early = ingest(
      store,
      upper.id,
      ["---", "verdict: verified", "draft: true", "pr: https://example.com/demo/pull/2", "---", "", "note"].join("\n"),
      {},
      false,
    );
    expect(early.ok).toBe(false);
    if (early.ok) return;
    expect(early.error).toBe("illegal_transition");
    dispatch(store, upper.id, false);
    const blocked = ingest(
      store,
      upper.id,
      ["---", "verdict: verified", "draft: true", "pr: https://example.com/demo/pull/2", "---", "", "note"].join("\n"),
      {},
      false,
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toBe("stack_order");
    const published = ingest(
      store,
      bottom.id,
      ["---", "verdict: verified", "draft: false", "pr: https://example.com/demo/pull/2", "---", "", "note"].join("\n"),
      {},
      false,
    );
    expect(published.ok).toBe(false);
    if (published.ok) return;
    expect(published.error).toBe("not_draft");
    expect(store.findSpec(bottom.id)?.state).toBe("dispatched");
    const verified = ingest(
      store,
      bottom.id,
      ["---", "verdict: verified", "draft: true", "pr: https://example.com/demo/pull/2", "---", "", "Synthetic note."].join("\n"),
      {},
      false,
    );
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.warning).toMatch(/report line/);
    expect(store.findSpec(bottom.id)?.state).toBe("verified");
    const repeat = ingest(
      store,
      bottom.id,
      ["---", "verdict: verified", "draft: true", "pr: https://example.com/demo/pull/2", "---", "", "Synthetic note."].join("\n"),
      {},
      false,
    );
    expect(repeat.ok).toBe(true);
    expect(store.findSpec(bottom.id)?.version).toBe(store.load().specs.find((spec) => spec.id === bottom.id)?.version);
  });

  test("a repeated finding becomes a lesson promoted to a gate", () => {
    const store = tempStore();
    expect(noteFinding(store, "g2:vague-verb", "Replace the vague verb.").ok).toBe(true);
    expect(store.load().lessons).toHaveLength(0);
    const second = noteFinding(store, "g2:vague-verb", "Replace the vague verb.");
    expect(second.ok).toBe(true);
    const lesson = store.load().lessons[0];
    expect(lesson?.promotedTo).toBe("G2");
    expect(lesson?.count).toBe(2);
    const line = readFileSync(join(store.root, "lessons.jsonl"), "utf8");
    expect(line).toContain("g2:vague-verb");
  });

  test("ingest asks GitHub whether the pull request is a draft", () => {
    const store = tempStore();
    const made = createIdea(store, "weather widget", false);
    if (!made.ok) throw new Error("create");
    const id = (made.data as Idea).id;
    restate(store, id, planner, false);
    approve(store, id, "Ship the smallest slice", false);
    const decomposed = decompose(store, id, planner, false);
    if (!decomposed.ok) throw new Error("decompose");
    const gated = gate(store, id, false);
    if (!gated.ok) throw new Error(JSON.stringify(gated));
    const specs = store.load().specs.filter((spec) => spec.ideaId === id).sort((a, b) => a.index - b.index);
    const bottom = specs[0];
    const upper = specs[1];
    if (!bottom || !upper) throw new Error("missing specs");
    expect(dispatch(store, bottom.id, false).ok).toBe(true);
    const pr = "https://github.com/example-org/demo-board/pull/3";
    const report = (draft: boolean) =>
      ["---", "verdict: verified", `draft: ${draft}`, `pr: ${pr}`, "---", "", "Synthetic note."].join("\n");

    const closed = ingest(store, bottom.id, report(true), { probe: () => ({ ok: true, draft: false }) }, false);
    expect(closed.ok).toBe(false);
    if (!closed.ok) {
      expect(closed.error).toBe("not_draft");
      expect(closed.message).toMatch(/GitHub says/);
    }
    expect(store.findSpec(bottom.id)?.state).toBe("dispatched");

    const offlineFalse = ingest(
      store,
      bottom.id,
      report(false),
      { probe: () => ({ ok: false, warning: "GitHub API was unreachable. Using the report line." }) },
      false,
    );
    expect(offlineFalse.ok).toBe(false);
    if (!offlineFalse.ok) expect(offlineFalse.warning).toMatch(/unreachable/);
    expect(store.findSpec(bottom.id)?.state).toBe("dispatched");

    const offlineTrue = ingest(
      store,
      bottom.id,
      report(true),
      { probe: () => ({ ok: false, warning: "GitHub API was unreachable. Using the report line." }) },
      false,
    );
    expect(offlineTrue.ok).toBe(true);
    if (offlineTrue.ok) expect(offlineTrue.warning).toMatch(/unreachable/);
    expect(store.findSpec(bottom.id)?.state).toBe("verified");

    expect(dispatch(store, upper.id, false).ok).toBe(true);
    const apiWins = ingest(store, upper.id, report(false), { probe: () => ({ ok: true, draft: true }) }, false);
    expect(apiWins.ok).toBe(true);
    if (apiWins.ok) expect(apiWins.warning).toBeUndefined();
    expect(store.findSpec(upper.id)?.state).toBe("verified");
  });

  test("seed puts five ideas on the board", () => {
    const store = tempStore();
    const seeded = seedDemo(store, planner);
    expect(seeded.ok).toBe(true);
    const snap = store.load();
    expect(snap.ideas.map((idea) => idea.state)).toEqual(["raw", "restated", "approved", "specced", "gated"]);
    expect(snap.lessons).toHaveLength(1);
  });

  test("merge, deploy, and send return 403", async () => {
    const store = tempStore();
    const running = await startServer({ store, port: 0 });
    try {
      for (const path of ["/api/merge", "/api/deploy", "/api/send"]) {
        const response = await fetch(`${running.url}${path}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
        expect(response.status).toBe(403);
        const body = (await response.json()) as { ok: boolean; error: string };
        expect(body.ok).toBe(false);
        expect(body.error).toBe("forbidden");
      }
      const health = (await (await fetch(`${running.url}/api/health`)).json()) as { service: string };
      expect(health.service).toBe("idea-foundry");
    } finally {
      await new Promise((resolve) => running.server.close(() => resolve(null)));
    }
  });
});
