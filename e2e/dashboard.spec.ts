import { expect, test } from "@playwright/test";

test("phone width keeps the page on one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Idea board" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stack lanes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lessons ledger" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statechart" })).toBeVisible();
  await expect(page.getByText("G2 fail").first()).toBeVisible();
  await expect(page.getByText("g2-vague")).toBeVisible();
  await expect(page.getByText("Checked by TLC")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("adds an idea and lands the stack from the bottom", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("New idea").fill("pomodoro focus timer");
  await page.getByRole("button", { name: "Add idea" }).click();
  const card = page.getByRole("article", { name: "pomodoro focus timer", exact: true });
  await expect(card).toHaveAttribute("data-state", "raw");
  await card.getByRole("button", { name: "Restate" }).click();
  await expect(card).toHaveAttribute("data-state", "restated");
  await card.getByRole("textbox", { name: "Approval note" }).fill("Ship the timer only.");
  await card.getByRole("button", { name: "Approve" }).click();
  await card.getByRole("button", { name: "Decompose" }).click();
  await card.getByRole("button", { name: "Run gates" }).click();
  await expect(page.getByText("G1 pass").first()).toBeVisible();

  const upper = page.getByRole("article", { name: /Show pomodoro focus timer on the board/ });
  const lower = page.getByRole("article", { name: /Define the acceptance command for pomodoro focus timer/ });
  await upper.getByRole("button", { name: "Dispatch" }).click();
  await lower.getByRole("button", { name: "Dispatch" }).click();
  await upper.getByRole("button", { name: "Record verified draft" }).click();
  await expect(page.getByRole("status")).toContainText(/cannot be verified/i);
  await lower.getByRole("button", { name: "Record verified draft" }).click();
  await expect(lower).toHaveAttribute("data-state", "verified");
  await upper.getByRole("button", { name: "Record verified draft" }).click();
  await expect(upper).toHaveAttribute("data-state", "verified");
  await expect(card).toHaveAttribute("data-state", "verified");
});
