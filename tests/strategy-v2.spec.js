import { test, expect } from "@playwright/test";

const row = { code: "1111", name: "驗證候選", side: "long", market: "上市", close: 20, score: 80, triggerPrice: 20.1, reasons: ["低點墊高", "相對強勢"], executionEligible: false };
const report = { version: "strategy-v2-20261112", tradeDate: "2026-11-12", dataDate: "2026-11-11", generatedAt: "2026-11-11T22:45:00Z", cutoff: "2026-11-12T07:00:00+08:00", preview: false, status: "ready", longCandidates: [row], shortCandidates: [], contrarianWatchlist: [row], warnings: ["資格未確認，只觀察"], config: { maxPrice: 50 } };
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-12T08:00:00+08:00"));
  await page.route("**/data/shared/strategy-v2-summary.json", (route) => route.fulfill({ json: { completeDays: 0, incompleteDays: 0, books: {} } }));
  await page.route("**/data/shared/strategy-v2-simulation-latest.json", (route) => route.fulfill({ status: 404, body: "" }));
});

test("V2 candidates are observation-only and do not manufacture performance", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/data/shared/strategy-v2-latest.json", (route) => route.fulfill({ json: report }));
  await page.goto("/market-risk-scanner/index.html");
  await expect(page.locator("#strategyV2")).toContainText("驗證候選");
  await expect(page.locator("#strategyV2")).toContainText("資格未確認，只觀察");
  await expect(page.locator("#strategyV2")).toContainText("尚無完整成交");
  await expect(page.locator("#bullishCount")).toHaveText("1");
  await expect(page.locator("#bearishCount")).toHaveText("0");
  await expect(page.locator("#tradeCount")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("strategy-v2.png") });
  await page.getByRole("button", { name: "開盤前報告" }).click();
  await expect(page.locator("#poLongCards")).toContainText("驗證候選");
  expect(errors).toEqual([]);
});

test("missing and stale V2 data cannot silently show the old candidates", async ({ page }) => {
  await page.route("**/data/shared/strategy-v2-latest.json", (route) => route.fulfill({ json: { ...report, tradeDate: "2026-11-11" } }));
  await page.goto("/market-risk-scanner/index.html");
  await expect(page.locator("#strategyV2")).toContainText("不使用昨日名單");
  await expect(page.locator("#bullishCount")).toHaveText("0");
  await expect(page.locator("#bearishCount")).toHaveText("0");
  await expect(page.locator("#strategyV2")).not.toContainText("驗證候選");
  await page.getByRole("button", { name: "舊版模擬紀錄" }).click();
  await expect(page.locator("#panel-simulation .hint")).toContainText("舊版歷史模擬");
});

test("blocked pre-open report shows the reason and no current candidates", async ({ page }) => {
  await page.route("**/data/shared/strategy-v2-latest.json", (route) => route.fulfill({ json: { ...report, status: "missed-cutoff", longCandidates: [] } }));
  await page.goto("/market-risk-scanner/index.html");
  await expect(page.locator("#strategyV2")).toContainText("錯過盤前截止");
  await expect(page.locator("#bullishCount")).toHaveText("0");
});

test("standalone order page uses V2 caps and rejects stale legacy substitution", async ({ page }) => {
  let current = true;
  await page.route("**/data/shared/strategy-v2-latest.json", (route) => route.fulfill({ json: { ...report, tradeDate: current ? report.tradeDate : "2026-11-11", longCandidates: Array.from({ length: 7 }, (_, i) => ({ ...row, code: String(1111 + i) })) } }));
  await page.goto("/market-risk-scanner/today-orders.html");
  await expect(page.locator("#bullishList .card")).toHaveCount(5);
  await expect(page.locator("#status")).toContainText("新版研究候選");
  current = false;
  await page.reload();
  await expect(page.locator("#status")).toContainText("停止載入舊候選");
  await expect(page.locator("#bullishList .card")).toHaveCount(0);
});
