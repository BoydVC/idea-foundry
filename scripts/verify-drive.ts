import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startServer } from "../src/server.ts";
import { packageRoot } from "../src/tlc.ts";

const root = packageRoot();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-verify-"));
const proof = path.join(root, "screenshots", "verify-add-idea.png");
const server = await startServer({
  port: 4450,
  dataDir,
  root,
  now: () => "2026-01-15T00:00:00.000Z",
});

try {
  const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
  const body = (await health.json()) as { ok?: boolean; ideas?: number };
  if (!health.ok || body.ok !== true || (body.ideas ?? 0) < 5) {
    throw new Error(`doctor failed: ${JSON.stringify(body)}`);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.getByRole("heading", { name: "Idea Foundry" }).waitFor();
  await page.getByLabel("Title").fill("indoor plant log");
  await page.getByRole("button", { name: "Add idea" }).click();
  await page.getByRole("button", { name: "indoor plant log" }).click();
  await page.getByRole("button", { name: "Restate" }).click();
  const question = page.getByText("Which output file should indoor plant log write?");
  await question.waitFor();
  await question.scrollIntoViewIfNeeded();
  fs.mkdirSync(path.dirname(proof), { recursive: true });
  await page.screenshot({ path: proof });
  await browser.close();
} finally {
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (!fs.existsSync(proof) || fs.statSync(proof).size < 1000) {
  process.stderr.write("proof png missing after cleanup\n");
  process.exit(1);
}
if (fs.existsSync(dataDir)) {
  process.stderr.write("data directory survived cleanup\n");
  process.exit(1);
}
process.stdout.write(`verify add-idea passed ${proof}\n`);
