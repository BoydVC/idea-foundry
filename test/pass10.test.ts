import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { clearQuarantine, listQuarantine } from "../src/commands.js";
import { parseTitle } from "../src/domain.js";
import { tempStore } from "./helpers.js";

function runCli(dir: string, args: string[]) {
  const out = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/cli.ts", "--data", dir, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FOUNDRY_OPEN_DRAFTS: "0" },
  });
  return JSON.parse(out.stdout) as { ok: boolean; idempotent?: boolean; data?: { counts?: { intake: number } } };
}

const accepted = [
  ["👩🏽‍💻 planner", "woman technologist, medium skin"],
  ["🧑🏿‍🦱 planner", "person, dark skin, curly hair"],
  ["👨🏻‍🤝‍👨🏼 planner", "holding hands, two skin tones"],
  ["👨‍👩‍👧 planner", "family zwj"],
  ["می\u200Cخواهم planner", "persian zwnj"],
  ["नाम\u200Cलेख planner", "devanagari zwnj"],
] as const;

const rejected = [
  ["\u200Dplanner", "leading zwj"],
  ["planner\u200D", "trailing zwj"],
  ["plan\u200D\u200Dner", "double zwj"],
  ["zero\u200Dwidth", "letter zwj letter"],
  ["\u200Cplanner", "leading zwnj"],
  ["planner\u200C", "trailing zwnj"],
  ["habit\u200Ctracker", "latin zwnj"],
  ["م\u200Ca planner", "arabic zwnj latin"],
] as const;

describe("pass 10", () => {
  test.each(accepted)("accepts %s (%s)", (title) => {
    expect(parseTitle(title)).toBe(title);
  });

  test.each(rejected)("rejects %s (%s)", (title) => {
    expect(() => parseTitle(title)).toThrow(/zero-width|control|bidi/);
  });

  test("quarantine lists torn paths and clear archives them once", () => {
    const store = tempStore();
    const intake = join(store.root, "intake.jsonl.torn");
    const events = join(store.root, "events.jsonl.torn");
    writeFileSync(intake, '{"ts":"2026-\n');
    writeFileSync(events, '{"at":"202\n{"at":"nope"\n');
    const listed = listQuarantine(store);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const data = listed.data as {
      counts: { events: number; ideas: number; lessons: number; intake: number };
      files: { name: string; path: string; lines: number }[];
      warning?: string;
    };
    expect(data.counts).toMatchObject({ events: 2, ideas: 0, lessons: 0, intake: 1 });
    const intakeFile = data.files.find((file) => file.name === "intake.jsonl.torn");
    const eventsFile = data.files.find((file) => file.name === "events.jsonl.torn");
    expect(intakeFile?.lines).toBe(1);
    expect(intakeFile?.path.endsWith("intake.jsonl.torn")).toBe(true);
    expect(eventsFile?.path.endsWith("events.jsonl.torn")).toBe(true);
    expect(data.warning).toMatch(/events 2/);
    expect(data.warning).toMatch(/intake 1/);
    expect(data.warning).toContain(intakeFile?.path ?? "missing");
    const viaCli = runCli(store.root, ["quarantine", "--list"]);
    expect(viaCli.ok).toBe(true);
    expect(viaCli.data?.counts?.intake).toBe(1);
    const cleared = clearQuarantine(store);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.idempotent).toBe(false);
    expect(existsSync(intake)).toBe(false);
    expect(existsSync(`${intake}.archive`)).toBe(true);
    expect(readFileSync(`${intake}.archive`, "utf8")).toBe('{"ts":"2026-\n');
    expect(store.quarantineCounts()).toEqual({ events: 0, ideas: 0, lessons: 0, intake: 0 });
    const again = clearQuarantine(store);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.idempotent).toBe(true);
    expect(readFileSync(`${intake}.archive`, "utf8")).toContain('{"ts":"2026-');
  });
});
