import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { taipeiDate, taipeiTime, V2_VERSION, V2_EFFECTIVE_DATE, executionGate } from "../market-risk-scanner/scripts/strategy-v2.js";
import { roundToTaiwanTick } from "../market-risk-scanner/scripts/preopen-research.js";
import { readJson, atomicJson } from "./run-strategy-v2.js";
import { mkdir, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const money = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const positive = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
const seconds = (time) => time.split(":").reduce((v, n) => v * 60 + Number(n), 0);

export function observedQuote(raw, tradeDate, now, config) {
  const date = String(raw?.d || raw?.["^"] || "").replaceAll("-", "");
  const time = String(raw?.t || "");
  const price = positive(raw?.z);
  if (date !== tradeDate.replaceAll("-", "") || !/^\d{2}:\d{2}:\d{2}$/.test(time) || !price || !positive(raw?.v)) return null;
  const at = `${tradeDate}T${time}+08:00`;
  const age = (now.getTime() - Date.parse(at)) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > config.maxQuoteAgeSeconds || time < "09:00:00" || time > "13:30:00") return null;
  return { price, at, time, bid: positive(String(raw.b || "").split("_")[0]), ask: positive(String(raw.a || "").split("_")[0]), locked: positive(raw.h) === positive(raw.l) };
}

export function fillPrice(quote, side, entering, config) {
  const buying = entering ? side === "long" : side === "short";
  const price = buying ? quote.ask : quote.bid;
  if (!price || quote.locked || (quote.bid && quote.ask && quote.ask < quote.bid)) return null;
  return roundToTaiwanTick(price * (1 + (buying ? 1 : -1) * config.slippageBps / 10000), buying ? "up" : "down");
}

export function closePosition(p, exitPrice, exitAt, reason, config) {
  const buyAmount = p.quantity * (p.side === "long" ? p.entryPrice : exitPrice);
  const sellAmount = p.quantity * (p.side === "short" ? p.entryPrice : exitPrice);
  const commission = money(Math.max(config.minCommission, buyAmount * config.commissionRate)) + money(Math.max(config.minCommission, sellAmount * config.commissionRate));
  // Conservative standard sale tax; a same-day timestamp alone does not prove
  // eligibility for the reduced day-trade tax or broker fee discounts.
  const tax = money(sellAmount * config.saleTaxRate);
  const borrowCost = p.side === "short" ? p.verification.borrowCostTwd : 0;
  const grossPnl = money(sellAmount - buyAmount);
  const netPnl = money(grossPnl - commission - tax - borrowCost);
  return { ...p, status: "closed", exitType: reason, exitPrice, exitAt, buyAmount: money(buyAmount), sellAmount: money(sellAmount), commission: money(commission), tax, borrowCost, grossPnl, netPnl, netPct: netPnl / (p.entryPrice * p.quantity) * 100 };
}

export function reportUsable(report, tradeDate) {
  if (tradeDate < V2_EFFECTIVE_DATE) return false;
  if (!report || report.version !== V2_VERSION || report.preview || report.status !== "ready" || report.tradeDate !== tradeDate || !(report.dataDate < tradeDate)) return false;
  if (!(Date.parse(report.generatedAt) < Date.parse(report.cutoff)) || report.cutoff !== `${tradeDate}T${report.config?.cutoff}+08:00`) return false;
  const { reportId, ...content } = report;
  return reportId === createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function advanceSimulation({ report, previous = null, quotes = [], now = new Date(), config }) {
  const tradeDate = taipeiDate(now), time = taipeiTime(now);
  if (!reportUsable(report, tradeDate)) return { version: V2_VERSION, marketDate: tradeDate, status: report?.tradeDate === tradeDate && report?.status === "market-closed" ? "market-closed" : "blocked", finalized: seconds(time) > seconds(config.forceClose) + config.forceCloseGraceSeconds, simulatedAt: now.toISOString(), positions: [], warnings: ["缺少當日有效盤前固定名單；不模擬、不使用舊報告。"] };
  if (previous && (previous.reportId !== report.reportId || previous.marketDate !== tradeDate)) throw new Error("Simulation/report identity mismatch");
  if (previous?.finalized) return previous;
  if (previous && Date.parse(previous.simulatedAt) > now.getTime()) return previous;
  if (JSON.stringify(config) !== JSON.stringify(report.config)) throw new Error("Execution settings must match frozen report");
  const byKey = new Map(quotes.map((q) => [`${q.c}|${q.ex === "otc" ? "上櫃" : "上市"}`, q]));
  const previousPositions = new Map((previous?.positions || []).map((p) => [p.id, p]));
  const rows = [...report.longCandidates, ...report.shortCandidates];
  const positions = [];
  const reserved = { atr: 0, baseline: 0 };
  for (const p of previousPositions.values()) if (p.entryPrice) reserved[p.book] += p.entryPrice * p.quantity;
  for (const book of ["atr", "baseline"]) for (const row of rows) {
    const id = `${book}:${row.side}:${row.code}|${row.market}`;
    let p = previousPositions.get(id) || { ...row, id, book, status: "watch", exitType: "watch", quantity: 0, netPnl: null };
    if (["closed", "unresolved", "unfilled"].includes(p.status)) { positions.push(p); continue; }
    const quote = observedQuote(byKey.get(`${row.code}|${row.market}`), tradeDate, now, config);
    if (p.status === "open") {
      const gap = (now.getTime() - Date.parse(p.lastObservedAt)) / 1000;
      if (gap > config.maxObservationGapSeconds || seconds(time) > seconds(config.forceClose) + config.forceCloseGraceSeconds) {
        p = { ...p, status: "unresolved", exitType: "unresolved", note: "行情觀測中斷或錯過平倉窗口；不虛構出場價。", netPnl: null };
      } else if (quote && Date.parse(quote.at) > Date.parse(p.lastObservedAt)) {
        const price = fillPrice(quote, row.side, false, config);
        const stop = row.side === "long" ? quote.price <= p.stopPrice : quote.price >= p.stopPrice;
        const target = row.side === "long" ? quote.price >= p.targetPrice : quote.price <= p.targetPrice;
        const force = quote.time >= config.forceClose;
        p = { ...p, price: quote.price, lastObservedAt: quote.at };
        if (price && (stop || target || force)) p = closePosition(p, price, quote.at, stop ? "stopLoss" : target ? "takeProfit" : "forceClose", config);
      }
    } else {
      const gate = executionGate(row.verification, row.side, tradeDate, now);
      if (!row.executionEligible || !gate.allowed) p.note = "資格未確認，僅觀察";
      else if (time > config.entryDeadline) p = { ...p, status: "unfilled", exitType: "unfilled", note: "進場窗口結束；未成交" };
      else if (quote && quote.time >= config.entryStart && quote.time <= config.entryDeadline) {
        const entry = fillPrice(quote, row.side, true, config);
        const crossed = row.side === "long" ? quote.price >= row.triggerPrice : quote.price <= row.triggerPrice;
        const gapOk = entry && Math.abs(entry / row.close - 1) * 100 <= config.maxEntryGapPct;
        const priceRule = row.side !== "short" || entry >= row.verification.minimumShortPrice;
        if (entry && crossed && gapOk && priceRule) {
          const stopPct = book === "atr" ? row.stopPct : config.baselineStopPct;
          const targetPct = book === "atr" ? row.targetPct : config.baselineTargetPct;
          const stopPrice = roundToTaiwanTick(entry * (1 + (row.side === "long" ? -1 : 1) * stopPct / 100), row.side === "long" ? "down" : "up");
          const estimatedCostPerShare = entry * (2 * config.commissionRate + config.saleTaxRate + 2 * config.slippageBps / 10000);
          const capacity = Math.min(config.initialCapital * config.maxPositionPct / 100, config.initialCapital - reserved[book]);
          const riskBudget = config.initialCapital * config.riskPerTradePct / 100 - (row.side === "short" ? row.verification.borrowCostTwd : 0) - 2 * config.minCommission;
          const maxShares = row.side === "short" ? row.verification.availableShares : Infinity;
          const quantity = Math.floor(Math.min(capacity / entry, riskBudget / (Math.abs(entry - stopPrice) + estimatedCostPerShare), maxShares) / config.lotSize) * config.lotSize;
          if (quantity > 0) {
            reserved[book] += entry * quantity;
            p = { ...p, status: "open", exitType: "holding", entryPrice: entry, entryAt: quote.at, lastObservedAt: quote.at, price: quote.price, quantity, stopPrice, targetPrice: roundToTaiwanTick(entry * (1 + (row.side === "long" ? 1 : -1) * targetPct / 100), row.side === "long" ? "up" : "down"), note: "觀測報價模擬，非券商成交", netPnl: null };
          } else p.note = "風險預算不足一交易單位";
        }
      }
      if (quote) {
        p.price = quote.price;
        p.observedAt = quote.at;
        p.referenceChangePct = (quote.price / row.close - 1) * 100 * (row.side === "long" ? 1 : -1);
      }
    }
    positions.push(p);
  }
  const finalized = seconds(time) > seconds(config.forceClose) + config.forceCloseGraceSeconds;
  const books = {};
  for (const book of ["atr", "baseline"]) {
    const selected = positions.filter((p) => p.book === book);
    const closed = selected.filter((p) => p.status === "closed");
    const unresolved = selected.filter((p) => ["open", "unresolved"].includes(p.status));
    const netPnl = finalized && !unresolved.length ? money(closed.reduce((s, p) => s + p.netPnl, 0)) : null;
    books[book] = { closedCount: closed.length, unresolvedCount: unresolved.length, netPnl, netPct: netPnl == null ? null : netPnl / config.initialCapital * 100, initialCapital: config.initialCapital, fees: money(closed.reduce((s, p) => s + p.commission + p.tax + p.borrowCost, 0)), bySide: Object.fromEntries(["long", "short"].map((side) => [side, { count: closed.filter((p) => p.side === side).length, closedNetPnl: money(closed.filter((p) => p.side === side).reduce((s, p) => s + p.netPnl, 0)) }])) };
  }
  return { version: V2_VERSION, reportId: report.reportId, reportDataDate: report.dataDate, marketDate: tradeDate, simulatedAt: now.toISOString(), localDate: tradeDate, localTime: time, status: positions.some((p) => p.status === "unresolved") ? "incomplete" : finalized ? "final" : "observing", finalized, books, netPnl: books.atr.netPnl, netPct: books.atr.netPct, positions, warnings: ["觀測價模擬，非實際成交；盤中取樣無法還原所有價格路徑，未接券商不代表可下單。"], contrarianWatchlist: report.contrarianWatchlist };
}

export async function runV2Simulation(now = new Date()) {
  const date = taipeiDate(now);
  if (date < V2_EFFECTIVE_DATE) throw new Error("V2 simulation is not effective yet");
  const config = await readJson(new URL("data/shared/strategy-v2-config.json", ROOT));
  const report = await readJson(new URL(`data/shared/strategy-v2-reports/${date}.json`, ROOT))
    || await readJson(new URL("data/shared/strategy-v2-latest.json", ROOT));
  const latest = new URL("data/shared/strategy-v2-simulation-latest.json", ROOT);
  const dayPath = new URL(`data/shared/strategy-v2-simulations/${date}.json`, ROOT);
  const final = await readJson(dayPath);
  if (final) { await atomicJson(latest, final); return final; }
  const prior = await readJson(latest);
  const previous = prior?.marketDate === date && prior?.reportId ? prior : null;
  let quotes = [];
  if (reportUsable(report, date)) {
    const candidates = [...report.longCandidates, ...report.shortCandidates];
    const channels = [...new Set(candidates.map((r) => `${r.market === "上櫃" ? "otc" : "tse"}_${r.code}.tw`))];
    if (channels.length) {
      const url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?" + new URLSearchParams({ ex_ch: channels.join("|"), json: "1", delay: "0" });
      try { const res = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); quotes = (await res.json()).msgArray || []; }
      catch (e) { console.error(`Quotes unavailable: ${e.message}`); }
    }
  }
  const snapshot = advanceSimulation({ report, previous, quotes, now: new Date(Math.max(now.getTime(), Date.now())), config });
  await atomicJson(latest, snapshot);
  if (snapshot.finalized) {
    await mkdir(new URL(".", dayPath), { recursive: true });
    try { await writeFile(dayPath, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx" }); }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  return snapshot;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runV2Simulation()));
