import { expect, test } from "@playwright/test";

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

  for (let index = 1; index <= count; index += 1) {
    const id = `s-0006-${index}`;
    await page.getByTestId(`dispatch-${id}`).click();
    await page.getByTestId(`ingest-${id}`).click();
    await expect(page.getByTestId(`spec-${id}`)).toContainText("verified");
    if (index === 1) {
      await expect(page.getByTestId("banner")).toContainText("report line");
    }
  }
  await expect(page.getByTestId("detail").locator(".mono").first()).toContainText("i-0006 · verified");

  const merge = await page.request.post("/api/merge");
  expect(merge.status()).toBe(403);
});
