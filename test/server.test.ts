import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/server.ts";

describe("dashboard server", () => {
  it("serves state and refuses merge, deploy, and send", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "foundry-http-"));
    const server = await startServer({ dataDir, port: 0 });
    try {
      const health = await fetch(`${server.url}/api/health`);
      expect(health.status).toBe(200);
      const created = await fetch(`${server.url}/api/idea`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "habit tracker export" }),
      });
      expect(created.status).toBe(200);
      const body = (await created.json()) as { ok: boolean; snapshot: { ideas: { title: string }[] } };
      expect(body.snapshot.ideas[0]?.title).toBe("habit tracker export");
      const chart = await fetch(`${server.url}/api/statechart`);
      const chartBody = (await chart.json()) as { mermaid: string; invariants: string[] };
      expect(chartBody.mermaid).toContain("stateDiagram-v2");
      expect(chartBody.invariants).toContain("StackLandsBottomUp");
      for (const path of ["/api/merge", "/api/deploy", "/api/send"]) {
        const response = await fetch(`${server.url}${path}`, { method: "POST", body: "{}" });
        expect(response.status, path).toBe(403);
        const denied = (await response.json()) as { next: string };
        expect(denied.next.toLowerCase()).toContain("draft");
      }
      const page = await fetch(`${server.url}/`);
      expect(await page.text()).toContain("Idea board");
    } finally {
      await server.close();
    }
  });
});
