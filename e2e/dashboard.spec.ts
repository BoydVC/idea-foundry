import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const shots = path.resolve("screenshots");

test("add an idea and land the stack as verified drafts", async ({ page }) => {
  fs.mkdirSync(shots, { recursive: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Idea Foundry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "habit tracker export" })).toBeVisible();
  await page.screenshot({ path: path.join(shots, "01-board.png") });
  await page.waitForTimeout(1200);

  await page.getByLabel("Title").fill("indoor plant log");
  await page.getByRole("button", { name: "Add idea" }).click();
  await page.getByRole("button", { name: "indoor plant log" }).click();
  await page.getByRole("button", { name: "Restate" }).click();
  await expect(page.getByText("Which output file should indoor plant log write?")).toBeVisible();
  await page.locator("#detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, "02-restated.png") });
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Decompose" }).click();
  await expect(page.getByText("1 lands first")).toBeVisible();
  await page.getByRole("button", { name: "Run gates" }).click();
  await expect(page.getByText("G1 pass").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("#detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, "03-gates.png") });
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Dispatch" }).first().click();
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.getByText(/s-\d{4}-1 · verified/)).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Dispatch" }).click();
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.locator(".column", { has: page.getByRole("heading", { name: "verified", exact: true }) }).getByRole("button", { name: "indoor plant log" })).toBeVisible();
  await page.screenshot({ path: path.join(shots, "04-verified.png") });
  await page.waitForTimeout(1000);

  await page.getByRole("button", { name: "Merge pull request" }).click();
  await expect(page.locator("#merge-result")).toContainText("403");
  await page.locator("#merge-result").scrollIntoViewIfNeeded();
  await expect(page.getByText("Demo User")).toBeVisible();
  await page.waitForTimeout(1000);
});
