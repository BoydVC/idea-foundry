import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { startServer } from "../src/server.js";
import { Store } from "../src/store.js";
import { acceptIntake, ensureDraftDay } from "./accept-draft-day.js";

export function writeDemoGif(videoPath: string, gifPath: string): void {
  const ran = spawnSync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-vf", "fps=8,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse", "-loop", "0", gifPath],
    { encoding: "utf8" },
  );
  if (ran.status !== 0) {
    const detail = (ran.stderr || ran.stdout || "ffmpeg failed").trim();
    throw new Error(`ffmpeg could not write ${gifPath}. Install ffmpeg (see README Prerequisites). ${detail}`);
  }
}

async function main(): Promise<void> {
if (!process.env.FOUNDRY_OPEN_DRAFTS) process.env.FOUNDRY_OPEN_DRAFTS = "0";
if (!process.env.FOUNDRY_GITHUB_DRAFT) process.env.FOUNDRY_GITHUB_DRAFT = "offline";
ensureDraftDay();

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
  await page.getByTestId("health-lessons").waitFor();
  await page.getByTestId("pipeline-health").scrollIntoViewIfNeeded();
  await pause(700);
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
  await page.getByTestId("panel-s-0006-1-G0").waitFor();
  await page.getByTestId("gates-panel").scrollIntoViewIfNeeded();
  await pause(1600);
  await page.screenshot({ path: "screenshots/03-gates.png" });

  const count = await page.locator('[data-testid^="spec-s-0006-"]').count();
  for (let index = 1; index <= count; index += 1) {
    const id = `s-0006-${index}`;
    await page.getByTestId(`dispatch-${id}`).click();
    await pause(400);
    if (index === 1) {
      const accepted = acceptIntake(join("data/demo", "intake.jsonl"));
      await page.evaluate((text) => {
        const banner = document.querySelector("#banner");
        if (!(banner instanceof HTMLElement)) return;
        banner.hidden = false;
        banner.textContent = text;
      }, `Draft Day accepted ${accepted.pickId} as intake.`);
      await page.getByTestId("banner").scrollIntoViewIfNeeded();
      await pause(1600);
      await page.screenshot({ path: "screenshots/04-packet.png" });
    }
    await page.getByTestId(`ingest-${id}`).click();
    await page.getByTestId(`spec-${id}`).getByText("verified").waitFor();
    await pause(500);
  }
  await page.getByTestId("detail").locator(".mono").first().getByText("verified").waitFor();
  await page.getByTestId("banner").scrollIntoViewIfNeeded();
  await pause(700);
  await page.screenshot({ path: "screenshots/05-verified.png" });
  await page.getByTestId("pipeline-health").scrollIntoViewIfNeeded();
  await page.getByTestId("health-mean").waitFor();
  await pause(800);
  await page.getByTestId("statechart").scrollIntoViewIfNeeded();
  await pause(900);
  await page.locator("#lessons").scrollIntoViewIfNeeded();
  await pause(700);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  await new Promise((resolve) => running.server.close(() => resolve(null)));
  if (video) {
    const path = await video.path();
    writeDemoGif(path, join("screenshots", "demo.gif"));
    process.stdout.write(`${join("screenshots", "demo.gif")}\n`);
  }
}
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  await main();
}
