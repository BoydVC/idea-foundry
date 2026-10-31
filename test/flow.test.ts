import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { packageRoot } from "../src/root.ts";
import { createFoundry } from "../src/service.ts";
import { readIntake, readSnapshot } from "../src/store.ts";

async function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundry-"));
}

const DRAFT = (verdict: "verified" | "rejected") => `---
draft: true
verdict: ${verdict}
---
Sample report. Synthetic data only. No personal data.
`;

const NOT_DRAFT = `---
draft: false
verdict: verified
---
Sample report. Synthetic data only. No personal data.
`;

describe("foundry flow", () => {
  it("round-trips idea, restate, and approve", async () => {
    const foundry = createFoundry(await dir(), { now: () => "2026-01-01T00:00:00.000Z" });
    const created = await foundry.idea("habit tracker export");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.ideaId!;
    const restated = await foundry.restate(id);
    expect(restated.ok && restated.snapshot.ideas[0]?.state).toBe("restated");
    expect(restated.ok && restated.snapshot.ideas[0]?.questions).toHaveLength(3);
    const again = await foundry.restate(id);
    expect(again.ok && again.noop).toBe(true);
    const approved = await foundry.approve(id, "Ship the sample slice.");
    expect(approved.ok && approved.snapshot.ideas[0]?.state).toBe("approved");
    const early = await foundry.idea("weather widget", { dryRun: true });
    expect(early.ok && early.dryRun).toBe(true);
    const stored = await foundry.state();
    expect(stored.ideas.map((idea) => idea.title)).toEqual(["habit tracker export"]);
  });

  it("refuses a stale version with 409 and leaves the board unchanged", async () => {
    const data = await dir();
    const foundry = createFoundry(data);
    const created = await foundry.idea("trivia scoring");
    expect(created.ok).toBe(true);
    const stale = await foundry.idea("reading list sync", { expectedVersion: 0 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.status).toBe(409);
      expect(stale.next).toContain("Re-read");
    }
    expect((await foundry.state()).ideas).toHaveLength(1);
  });

  it("dispatches a draft-day intake packet and refuses a pull request that is not a draft", async () => {
    const data = await dir();
    const foundry = createFoundry(data, { now: () => "2026-01-01T00:00:00.000Z" });
    const created = await foundry.idea("pomodoro focus timer");
    if (!created.ok || !created.ideaId) throw new Error("idea");
    const id = created.ideaId;
    expect((await foundry.restate(id)).ok).toBe(true);
    expect((await foundry.approve(id, "Ship the timer only.")).ok).toBe(true);
    const decomposed = await foundry.decompose(id);
    expect(decomposed.ok && decomposed.snapshot.specs).toHaveLength(2);
    const gated = await foundry.gate(id);
    expect(gated.ok && gated.snapshot.specs.every((spec) => spec.state === "gated")).toBe(true);
    const specs = (await foundry.state()).specs;
    const first = specs.find((spec) => spec.index === 1);
    const second = specs.find((spec) => spec.index === 2);
    if (!first || !second) throw new Error("specs");
    const blocked = await foundry.ingest(second.id, DRAFT("verified"), "https://github.com/BoydVC/idea-foundry/pull/2");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain(first.id);
    const dispatched = await foundry.dispatch(first.id);
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok || !dispatched.packet) throw new Error("packet");
    expect(dispatched.packet.draftOnly).toBe(true);
    expect(dispatched.packet.intake).toMatchObject({
      source: "foundry",
      target: "BoydVC/idea-foundry",
      n: 3,
    });
    expect(dispatched.packet.intake.idea).toContain(first.title);
    const lines = await readIntake(data);
    expect(lines[0]).toMatchObject({ source: "foundry", target: "BoydVC/idea-foundry", n: 3, offset: 1 });
    const repeat = await foundry.dispatch(first.id);
    expect(repeat.ok && repeat.noop).toBe(true);
    const refused = await foundry.ingest(first.id, NOT_DRAFT, "https://github.com/BoydVC/idea-foundry/pull/1");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("not a draft");
    expect((await foundry.state()).specs.find((spec) => spec.id === first.id)?.state).toBe("dispatched");
    const verified = await foundry.ingest(first.id, DRAFT("verified"), "https://github.com/BoydVC/idea-foundry/pull/1");
    expect(verified.ok && verified.snapshot.specs.find((spec) => spec.id === first.id)?.state).toBe("verified");
    const upper = await foundry.dispatch(second.id);
    expect(upper.ok).toBe(true);
    const upperVerified = await foundry.ingest(second.id, DRAFT("verified"), "https://github.com/BoydVC/idea-foundry/pull/2");
    expect(upperVerified.ok && upperVerified.snapshot.ideas[0]?.state).toBe("verified");
  });

  it("seeds five ideas into 14 specs and records a repeated vague-verb lesson", async () => {
    const foundry = createFoundry(await dir(), { now: () => "2026-01-01T00:00:00.000Z" });
    const seeded = await foundry.seed();
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    expect(seeded.snapshot.ideas).toHaveLength(5);
    expect(seeded.snapshot.specs.length).toBeGreaterThanOrEqual(14);
    const weather = seeded.snapshot.ideas.find((idea) => idea.title === "weather widget");
    const red = seeded.snapshot.specs.find((spec) => spec.ideaId === weather?.id && spec.gates.some((gate) => !gate.pass));
    expect(red?.state).toBe("specced");
    expect(red?.gates.find((gate) => gate.gate === "G2")?.pass).toBe(false);
    expect(seeded.snapshot.lessons.some((lesson) => lesson.code === "g2-vague" && lesson.gate === "G2")).toBe(true);
    const second = await foundry.seed();
    expect(second.ok && second.noop).toBe(true);
    expect((await foundry.state()).ideas).toHaveLength(5);
  });
});

describe("cli", () => {
  it("prints JSON for idea, restate, and approve", async () => {
    const data = await dir();
    const root = packageRoot();
    const run = (args: string[]) =>
      new Promise<{ code: number; stdout: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["src/cli.ts", ...args, "--data", data], { cwd: root });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
      });
    const created = await run(["idea", "keyboard shortcut cheat sheet"]);
    expect(created.code).toBe(0);
    const idea = JSON.parse(created.stdout) as { ideaId: string };
    expect((await run(["restate", idea.ideaId])).code).toBe(0);
    const approved = await run(["approve", idea.ideaId, "--note", "Ship the sample slice."]);
    expect(approved.code).toBe(0);
    expect(JSON.parse(approved.stdout).snapshot.ideas[0].state).toBe("approved");
    const dry = await run(["idea", "trivia scoring", "--dry-run"]);
    expect(JSON.parse(dry.stdout).dryRun).toBe(true);
    const stored = JSON.parse(await readFile(join(data, "state.json"), "utf8")) as { ideas: { title: string }[] };
    expect(stored.ideas.map((item) => item.title)).toEqual(["keyboard shortcut cheat sheet"]);
    const snap = await readSnapshot(data);
    expect(snap.ideas[0]?.state).toBe("approved");
  });
});
