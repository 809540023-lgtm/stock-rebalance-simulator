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

test("risk scanner shows candidate, holdings, and history tabs", async ({ page }) => {
  await page.goto("/market-risk-scanner/index.html");
  await expect(page.getByRole("heading", { name: "候選、持倉與歷史績效" })).toBeVisible();
  await expect(page.locator("#bullishCount")).toHaveText(/\d+/);
  await expect(page.locator("#bearishCount")).toHaveText(/\d+/);
  await expect(page.locator("#bullishCards .card")).not.toHaveCount(0);
  await page.getByRole("button", { name: /空頭候選/ }).click();
  await expect(page.locator("#panel-bearish")).toHaveClass(/active/);
  await expect(page.locator("#bearishCards .card")).not.toHaveCount(0);
  await page.getByRole("button", { name: /實際持倉/ }).click();
  await expect(page.locator("#panel-holdings")).toHaveClass(/active/);
  await expect(page.locator("#holdingsBody tr")).not.toHaveCount(0);
  await page.getByRole("button", { name: /歷史績效/ }).click();
  await expect(page.locator("#panel-history")).toHaveClass(/active/);
  await expect(page.locator("#historyBody tr")).not.toHaveCount(0);
});

test("user can add a custom holding from the holdings tab", async ({ page }) => {
  await page.goto("/market-risk-scanner/index.html");
  await page.getByRole("button", { name: /實際持倉/ }).click();
  await page.locator("#hCode").fill("9999");
  await page.locator("#hName").fill("測試股");
  await page.locator("#hBuyPrice").fill("50");
  await page.locator("#hQty").fill("1000");
  await page.locator("#hBuyDate").fill("2026-08-18");
  await page.getByRole("button", { name: "新增持倉" }).click();
  await expect(page.locator("#holdingsBody")).toContainText("9999");
  await expect(page.locator("#holdingsBody")).toContainText("測試股");
});

test("today's trade tracker loads candidates and records a trade", async ({ page }) => {
  await page.goto("/market-risk-scanner/index.html");
  await page.getByRole("button", { name: /今日下單追蹤/ }).click();
  await expect(page.locator("#panel-trades")).toHaveClass(/active/);
  await expect(page.locator("#tradeBullishBody tr")).not.toHaveCount(0);
  await expect(page.locator("#tradeBearishBody tr")).not.toHaveCount(0);
  const firstCode = await page.locator("#tradeBullishBody [data-record]").first().getAttribute("data-record");
  await page.locator("[data-fill=\"" + firstCode + "\"]").fill("10");
  await page.locator("[data-qty=\"" + firstCode + "\"]").fill("1000");
  await page.locator("[data-record=\"" + firstCode + "\"]").click();
  await expect(page.locator("#tradeCount")).toHaveText("1");
});
