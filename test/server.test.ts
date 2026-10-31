import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { packageRoot } from "../src/tlc.ts";
import { startServer } from "../src/server.ts";

test("the dashboard API serves state and refuses merge, deploy, and send", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-http-"));
  const server = await startServer({
    port: 0,
    dataDir,
    root: packageRoot(),
    now: () => "2026-01-15T00:00:00.000Z",
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    const state = await fetch(`${base}/api/state`);
    const body = await state.json() as { ideas: { title: string }[] };
    expect(body.ideas.map((idea) => idea.title)).toContain("habit tracker export");
    const chart = await fetch(`${base}/api/statechart`);
    const chartBody = await chart.json() as { mmd: string; rows: unknown[] };
    expect(chartBody.mmd).toMatch(/stateDiagram-v2/);
    expect(chartBody.rows.length).toBeGreaterThan(0);
    const page = await fetch(`${base}/`);
    expect(await page.text()).toMatch(/Idea Foundry/);
    for (const pathName of ["/api/merge", "/api/deploy", "/api/send"]) {
      const refused = await fetch(`${base}${pathName}`, { method: "POST", body: "{}" });
      expect(refused.status).toBe(403);
      const payload = await refused.json() as { next: string };
      expect(payload.next.length).toBeGreaterThan(0);
    }
    const created = await fetch(`${base}/api/idea`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "indoor plant log" }),
    });
    expect(created.status).toBe(201);
  } finally {
    await server.close();
  }
});
