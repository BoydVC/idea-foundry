import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { startServer } from "../src/server.js";
import { Store } from "../src/store.js";

const store = new Store("data/demo");
store.reset();
const running = await startServer({ store, port: 4440, seed: true });
mkdirSync("screenshots/raw", { recursive: true });
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "screenshots/raw", size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const pause = (ms: number) => page.waitForTimeout(ms);

try {
  await page.goto(running.url);
  await page.getByRole("heading", { name: "Idea Foundry" }).waitFor();
  await pause(1200);
  await page.screenshot({ path: "screenshots/01-board.png" });

  await page.getByTestId("add-idea-title").fill("unit converter card");
  await pause(600);
  await page.getByTestId("add-idea-submit").click();
  await page.getByTestId("idea-i-0006").waitFor();
  await pause(800);

  await page.getByTestId("action-restate").click();
  await page.getByText("In our own words").waitFor();
  await pause(800);
  await page.getByTestId("action-approve").click();
  await pause(700);
  await page.getByTestId("action-decompose").click();
  await page.getByTestId("spec-s-0006-1").waitFor();
  await pause(900);
  await page.screenshot({ path: "screenshots/02-stack.png" });

  await page.getByTestId("action-gate").click();
  await page.getByTestId("gate-s-0006-1-G1").waitFor();
  await pause(900);
  await page.screenshot({ path: "screenshots/03-gates.png" });

  const count = await page.locator('[data-testid^="spec-s-0006-"]').count();
  for (let index = 1; index <= count; index += 1) {
    const id = `s-0006-${index}`;
    await page.getByTestId(`dispatch-${id}`).click();
    await pause(400);
    await page.getByTestId(`ingest-${id}`).click();
    await page.getByTestId(`spec-${id}`).getByText("verified").waitFor();
    await pause(500);
  }
  await page.getByTestId("detail").locator(".mono").first().getByText("verified").waitFor();
  await pause(800);
  await page.screenshot({ path: "screenshots/04-verified.png" });
  await page.getByTestId("statechart").scrollIntoViewIfNeeded();
  await pause(1500);
  await page.locator("#lessons").scrollIntoViewIfNeeded();
  await pause(1000);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  await new Promise((resolve) => running.server.close(() => resolve(null)));
  if (video) {
    const path = await video.path();
    process.stdout.write(`${path}\n`);
  }
}
