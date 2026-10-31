import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { chromium } from "@playwright/test";

const port = 4440;
const dataDir = ".tmp/demo";
await rm(dataDir, { recursive: true, force: true });
await rm("screenshots/raw", { recursive: true, force: true });
await mkdir("screenshots/raw", { recursive: true });
await mkdir("screenshots", { recursive: true });

const server = spawn(process.execPath, ["src/cli.ts", "serve", "--port", String(port), "--data", dataDir, "--seed"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`server did not start\n${serverLog}`);
}

try {
  await waitReady();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: "screenshots/raw", size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole("heading", { name: "Idea board" }).waitFor();
  await page.screenshot({ path: "screenshots/board.png" });
  await page.waitForTimeout(2200);
  await page.getByRole("heading", { name: "Stack lanes" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/lanes.png" });
  await page.getByRole("heading", { name: "Lessons ledger" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "screenshots/lessons.png" });
  await page.locator("#statechart").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/statechart.png" });
  await page.locator("header").scrollIntoViewIfNeeded();
  await page.getByLabel("New idea").fill("pomodoro focus timer");
  await page.getByRole("button", { name: "Add idea" }).click();
  const card = page.getByRole("article", { name: "pomodoro focus timer", exact: true });
  await card.getByRole("button", { name: "Restate" }).click();
  await page.waitForTimeout(400);
  await card.getByRole("textbox", { name: "Approval note" }).fill("Ship the timer only.");
  await card.getByRole("button", { name: "Approve" }).click();
  await card.getByRole("button", { name: "Decompose" }).click();
  await card.getByRole("button", { name: "Run gates" }).click();
  await page.waitForTimeout(500);
  const lower = page.getByRole("article", { name: /Define the acceptance command for pomodoro focus timer/ });
  await lower.getByRole("button", { name: "Dispatch" }).click();
  await lower.getByRole("button", { name: "Record verified draft" }).click();
  await page.getByRole("heading", { name: "Stack lanes" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2200);
  await context.close();
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

const webm = spawnSync("find", ["screenshots/raw", "-name", "*.webm"], { encoding: "utf8" });
const video = webm.stdout.trim().split("\n").find((line) => line.endsWith(".webm"));
if (!video) throw new Error("no video recorded");
const gif = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    video,
    "-vf",
    "fps=5,scale=460:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=48:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "screenshots/demo.gif",
  ],
  { stdio: "inherit" },
);
if (gif.status !== 0) process.exit(gif.status ?? 1);
const probe = spawnSync(
  "ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", "screenshots/demo.gif"],
  { encoding: "utf8" },
);
const duration = Number(probe.stdout.trim());
const size = (await stat("screenshots/demo.gif")).size;
console.log(JSON.stringify({ duration, bytes: size, video }));
if (!(duration >= 8 && duration <= 20) || size > 5_000_000) {
  throw new Error(`gif out of bounds duration=${duration} bytes=${size}`);
}
