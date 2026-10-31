import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { main } from "../src/cli.ts";

const now = () => "2026-01-15T00:00:00.000Z";

function run(args: string[], dir: string) {
  let stdout = "";
  let stderr = "";
  const code = main(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    env: {},
    cwd: dir,
    now,
  });
  return { code, stdout, stderr, json: stdout ? JSON.parse(stdout) as Record<string, unknown> : null };
}

test("the CLI round-trips idea, restate, and approve as JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-"));
  const created = run(["idea", "trivia scoring", "--data", dir], dir);
  expect(created.code).toBe(0);
  const idea = (created.json?.idea as { id: string }).id;
  expect(run(["restate", idea, "--data", dir], dir).code).toBe(0);
  const approved = run(["approve", idea, "--note", "Keep the fixture", "--data", dir], dir);
  expect(approved.code).toBe(0);
  expect((approved.json?.idea as { state: string }).state).toBe("approved");
});

test("ingest refuses a report that is not a draft", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-"));
  const created = run(["idea", "kitchen timer", "--data", dir], dir);
  const idea = (created.json?.idea as { id: string }).id;
  expect(run(["restate", idea, "--data", dir], dir).code).toBe(0);
  expect(run(["approve", idea, "--note", "Keep the fixture", "--data", dir], dir).code).toBe(0);
  expect(run(["decompose", idea, "--data", dir], dir).code).toBe(0);
  expect(run(["gate", idea, "--data", dir], dir).code).toBe(0);
  const show = run(["show", idea, "--data", dir], dir);
  const specs = show.json?.specs as { id: string }[];
  const first = specs[0]?.id;
  expect(first).toBeTruthy();
  expect(run(["dispatch", first ?? "", "--data", dir], dir).code).toBe(0);
  const report = path.join(dir, "report.md");
  fs.writeFileSync(report, "draft: false\noutcome: verified\n");
  const refused = run(
    ["ingest", first ?? "", "--report", report, "--pr", "https://github.com/BoydVC/idea-foundry/pull/9", "--data", dir],
    dir,
  );
  expect(refused.code).toBe(1);
  expect(refused.stderr).toMatch(/not a draft/);
  expect(refused.stderr).toMatch(/next/);
});

test("a missing command tells the next step", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-cli-"));
  const help = run(["help"], dir);
  expect(help.code).toBe(0);
  expect(help.stdout).toMatch(/foundry idea/);
  expect(fs.existsSync(path.join(dir, "data"))).toBe(false);
});
