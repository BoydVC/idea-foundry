import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";

async function waitForHealth(url: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* still booting */
    }
    if (Date.now() - started > 20_000) throw new Error(`No health at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test("phone width keeps the board on the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Idea Foundry" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pipeline health" })).toBeVisible();
  await expect(page.getByTestId("health-states")).toContainText("raw");
  await expect(page.getByTestId("health-lessons")).toHaveText("1");
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statechart" })).toBeVisible();
  await expect(page.getByTestId("invariants")).toContainText("DispatchRequiresGate");
  await expect(page.getByRole("heading", { name: "Lessons", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("add an idea and verify the bottom of its stack", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Idea Foundry" })).toBeVisible();
  await expect(page.getByTestId("idea-i-0001")).toBeVisible();
  await expect(page.getByTestId("lessons")).toContainText("G2");
  await expect(page.getByTestId("statechart").locator("svg")).toBeVisible();

  await page.getByTestId("add-idea-title").fill("unit converter card");
  await page.getByTestId("add-idea-submit").click();
  await expect(page.getByTestId("idea-i-0006")).toBeVisible();

  await page.getByTestId("action-restate").click();
  await expect(page.getByTestId("detail")).toContainText("In our own words");
  await page.getByTestId("action-approve").click();
  await page.getByTestId("action-decompose").click();
  await expect(page.getByTestId("spec-s-0006-1")).toBeVisible();
  const count = await page.locator('[data-testid^="spec-s-0006-"]').count();
  expect(count).toBeGreaterThanOrEqual(2);

  await page.getByTestId("action-gate").click();
  await expect(page.getByTestId("gate-s-0006-1-G1")).toContainText("G1 pass");
  await expect(page.getByTestId("gate-s-0006-1-G2")).toContainText("G2 pass");
  await expect(page.getByTestId("gate-s-0006-1-G3")).toContainText("G3 pass");
  await expect(page.getByTestId("gates-panel")).toContainText("architecture");
  await expect(page.getByTestId("gates-panel")).toContainText("proof 4");

  for (let index = 1; index <= count; index += 1) {
    const id = `s-0006-${index}`;
    await page.getByTestId(`dispatch-${id}`).click();
    await page.getByTestId(`ingest-${id}`).click();
    await expect(page.getByTestId(`spec-${id}`)).toContainText("verified");
    if (index === 1) {
      await expect(page.getByTestId("health-spec-results")).toContainText("verified 1");
      await expect(page.getByTestId("idea-outcome-i-0006")).toContainText("gated");
      await expect(page.getByTestId("idea-outcome-i-0006")).toContainText("1 verified");
      await expect(page.getByTestId("banner")).toContainText("report line");
    }
  }
  await expect(page.getByTestId("detail").locator(".mono").first()).toContainText("i-0006 · verified");
  await expect(page.locator(".column").filter({ has: page.getByRole("heading", { name: /^verified\b/ }) }).getByTestId("idea-i-0006")).toBeVisible();

  const merge = await page.request.post("/api/merge");
  expect(merge.status()).toBe(403);
});

test("an older refresh does not cover a newer board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("idea-i-0001")).toBeVisible();
  const stale = await page.evaluate(async () => {
    const response = await fetch("/api/state");
    return response.text();
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hits = 0;
  await page.route("**/api/state", async (route) => {
    hits += 1;
    if (hits === 1) {
      await gate;
      await route.fulfill({ status: 200, contentType: "application/json", body: stale });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => {
    const form = document.querySelector("#add-form");
    const input = document.querySelector("#add-idea-title");
    if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) return;
    input.value = "slow widget";
    form.requestSubmit();
    input.value = "fast widget";
    form.requestSubmit();
  });
  await expect(page.getByTestId("board").getByText("fast widget")).toBeVisible();
  release();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("board").getByText("fast widget")).toBeVisible();
  await expect(page.getByTestId("board").getByText("slow widget")).toBeVisible();
});

test("idea titles render as text", async ({ page }) => {
  await page.goto("/");
  const title = "<img src=x onerror=alert(1)>";
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    dialog.dismiss().catch(() => undefined);
  });
  await page.getByTestId("add-idea-title").fill(title);
  await page.getByTestId("add-idea-submit").click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  expect(dialogs).toBe(0);
  const html = await page.locator("[data-testid='detail'] h2").evaluate((node) => node.innerHTML);
  expect(html).toContain("&lt;img");
});

test("two dashboards on 4440 and 4441 keep separate data", async ({ request }) => {
  let child: ChildProcess | undefined;
  const side = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/server.ts"], {
    env: {
      ...process.env,
      FOUNDRY_DATA: "data/e2e-side",
      FOUNDRY_FRESH: "1",
      FOUNDRY_SEED: "1",
      FOUNDRY_PORT: "4441",
      PORT: "4441",
      FOUNDRY_OPEN_DRAFTS: "0",
    },
  });
  child = side;
  try {
    await waitForHealth("http://127.0.0.1:4441/api/health");
    const added = await fetch("http://127.0.0.1:4441/api/idea", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "side board widget" }),
    });
    expect(added.ok).toBe(true);
    const right = (await (await fetch("http://127.0.0.1:4441/api/state")).json()) as { ideas: { title: string }[] };
    const left = (await (await request.get("/api/state")).json()) as { ideas: { title: string }[] };
    const health = (await (await fetch("http://127.0.0.1:4441/api/health")).json()) as { port: number };
    expect(health.port).toBe(4441);
    expect(right.ideas.some((idea) => idea.title === "side board widget")).toBe(true);
    expect(left.ideas.some((idea) => idea.title === "side board widget")).toBe(false);
  } finally {
    child?.kill("SIGTERM");
  }
});
