import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { startServer } from "../src/server.js";
import { Store } from "../src/store.js";

const dataDir = `/tmp/foundry-verify-${process.pid}`;
const store = new Store(dataDir);
store.reset();
const running = await startServer({ store, port: 4460, seed: true });
mkdirSync("screenshots/proof", { recursive: true });
const lines: string[] = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let failed = false;

try {
  const healthResponse = await fetch(`${running.url}/api/health`);
  const health = (await healthResponse.json()) as { ok: boolean; service: string; port: number; ideas: number };
  lines.push(`doctor ${healthResponse.status} ${JSON.stringify(health)}`);
  if (!health.ok || health.service !== "idea-foundry" || health.port !== 4460 || health.ideas < 1) {
    throw new Error("doctor failed");
  }
  await page.goto(running.url);
  await page.getByTestId("add-idea-title").fill("unit converter card");
  await page.getByTestId("add-idea-submit").click();
  await page.getByTestId("idea-i-0006").waitFor();
  await page.screenshot({ path: "screenshots/proof/add-idea.png" });
  const stateResponse = await fetch(`${running.url}/api/state`);
  const state = (await stateResponse.json()) as { ideas: { id: string; title: string; state: string }[] };
  const created = state.ideas.find((idea) => idea.id === "i-0006");
  lines.push(`state ${JSON.stringify(created)}`);
  if (!created || created.title !== "unit converter card" || created.state !== "raw") {
    throw new Error("stored idea did not match the form");
  }
  const merge = await fetch(`${running.url}/api/merge`, { method: "POST" });
  lines.push(`merge ${merge.status}`);
  if (merge.status !== 403) throw new Error("merge was not forbidden");
  const pii = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/pii-scan.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  lines.push((pii.stdout ?? "").trim());
  if (pii.status !== 0) throw new Error((pii.stderr || pii.stdout || "pii scan failed").trim());
  lines.push("ok");
} catch (error) {
  failed = true;
  lines.push(error instanceof Error ? error.message : "failed");
} finally {
  writeFileSync("screenshots/proof/add-idea.log", `${lines.join("\n")}\n`);
  await page.close();
  await browser.close();
  await new Promise((resolve) => running.server.close(() => resolve(null)));
  store.reset();
}
process.exit(failed ? 1 : 0);
