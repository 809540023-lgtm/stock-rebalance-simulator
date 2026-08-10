import { test, expect } from "@playwright/test";

test("standalone risk scanner renders its own snapshot", async ({ page }) => {
  await page.goto("/market-risk-scanner/index.html");
  await expect(page.locator("h1")).toHaveText("台股下跌速度與風險掃描器");
  await expect(page.locator("#status")).not.toHaveClass(/error/);
  await expect(page.locator("#indexBody tr")).not.toHaveCount(0);
  await expect(page.locator("#riskChart")).toBeVisible();
  await expect(page.locator("#indexChart")).toBeVisible();
  await expect(page.getByRole("heading", { name: "LINE 價格異動監控" })).toBeVisible();
  await expect(page.locator("#monitorMarket")).toHaveText("上市");
});
