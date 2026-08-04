import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
});

test("default scenario renders calculations and trades", async ({ page }) => {
  await expect(page.locator("#finalAsset")).not.toHaveText("NT$0");
  await expect(page.locator("#logWrap")).toContainText("賣出");
  await expect(page.locator("#logWrap")).toContainText("買回");
  await expect(page.locator("#validationMessage")).not.toHaveClass(/show/);
});

test("gap crossing executes at each trigger price", async ({ page }) => {
  await page.locator("#pricePath").fill("103, 110");
  const log = page.locator("#logWrap");
  await expect(log).toContainText("$108");
  await expect(log).toContainText("$110");
  await expect(log).not.toContainText("買回");
});

test("saved cases preserve valid zero values", async ({ page }) => {
  await page.locator("#caseName").fill("零值測試");
  await page.locator("#maxSellPct").fill("0");
  await page.locator("#buyFeePct").fill("0");
  await page.locator("#saveCaseBtn").click();
  await page.locator("#maxSellPct").fill("10");
  await page.locator("#buyFeePct").fill("1");
  await page.locator("[data-load-case]").first().click();
  await expect(page.locator("#maxSellPct")).toHaveValue("0");
  await expect(page.locator("#buyFeePct")).toHaveValue("0");
});

test("official market data can update a listed symbol", async ({ page, request }) => {
  const response = await request.get("/data/twse-latest.json");
  const market = await response.json();
  const expectedClose = String(market.stocks["0050"].close);
  await page.locator("#symbol").fill("0050");
  await page.locator("#updateSellPriceBtn").click();
  await expect(page.locator("#currentPrice")).toHaveValue(expectedClose);
  await expect(page.locator("#sellPriceStatus")).toContainText("證交所資料");
});

test("page does not overflow the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only layout check");
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
