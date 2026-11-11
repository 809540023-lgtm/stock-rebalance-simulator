import { createHash } from "node:crypto";
import { buildPreopenFeatures, DEFAULT_PREOPEN_CONFIG, roundToTaiwanTick, assertIsoDate } from "./preopen-research.js";

export const V2_EFFECTIVE_DATE = "2026-11-12";
export const V2_VERSION = "strategy-v2-20261112";
export const taipeiDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);
export const taipeiTime = (now = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);
export const activeV2 = (now = new Date()) => taipeiDate(now) >= V2_EFFECTIVE_DATE;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function calendarSessions(rows, year) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Official calendar unavailable");
  const days = new Map();
  for (const row of rows) {
    const raw = String(row.Date || "");
    if (!/^\d{7}$/.test(raw)) throw new Error("Invalid exchange calendar date");
    const date = assertIsoDate(`${Number(raw.slice(0, 3)) + 1911}-${raw.slice(3, 5)}-${raw.slice(5)}`);
    if (date.startsWith(String(year))) days.set(date, /開始交易|最後交易/.test(row.Name + row.Description));
  }
  if (!days.size) throw new Error("Exchange calendar does not cover requested year");
  const sessions = [];
  for (const d = new Date(`${year}-01-01T00:00:00Z`); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const open = days.has(date) ? days.get(date) : ![0, 6].includes(d.getUTCDay());
    if (open) sessions.push(date);
  }
  return sessions;
}

export function validateSeries(bars, sessions, asOfDate, minBars = 61) {
  const expected = sessions.filter((d) => d <= asOfDate).slice(-minBars);
  if (expected.length < minBars || expected.at(-1) !== asOfDate) throw new Error("Insufficient exchange sessions");
  const map = new Map();
  for (const bar of bars || []) {
    assertIsoDate(bar.date);
    if (bar.date > asOfDate) throw new Error("Future bar in research input");
    if (map.has(bar.date)) throw new Error("Duplicate daily bar");
    if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("Invalid numeric bar");
    if (bar.low <= 0 || bar.volume < 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) throw new Error("Invalid OHLC range");
    map.set(bar.date, bar);
  }
  if (expected.some((d) => !map.has(d))) throw new Error("Missing trading sessions");
  return expected.map((d) => map.get(d));
}

export function scoreV2(f, bars, regime) {
  const lows = bars.slice(-5).map((b) => b.low);
  const priorLows = bars.slice(-10, -5).map((b) => b.low);
  const longRules = [
    [f.close > f.ma5 && f.ma5 > f.ma20, 20, "站回短中期均線"],
    [f.slope10 > 0, 15, "短線斜率轉正"],
    [Math.min(...lows) > Math.min(...priorLows), 15, "低點墊高"],
    [f.relative5Pct > 0 && f.relative20Pct > 0, 20, "相對大盤轉強"],
    [f.volumeBalance10 > 0, 15, "上漲量能確認"],
    [f.return20Pct < 0 && f.return5Pct > 0, 15, "跌後反轉確認"]
  ];
  const shortRules = [
    [f.close < f.ma5 && f.ma5 < f.ma20, 20, "短中期空頭排列"],
    [f.slope10 < 0, 15, "短線斜率向下"],
    [Math.min(...lows) < Math.min(...priorLows), 15, "低點下移"],
    [f.relative5Pct < 0 && f.relative20Pct < 0, 20, "持續弱於大盤"],
    [f.volumeBalance10 < 0, 15, "下跌量能確認"],
    [f.return5Pct < 0 && f.return20Pct < 0, 15, "中短期同步轉弱"]
  ];
  const result = (rules, mandatory) => ({ score: rules.reduce((s, [pass, weight]) => s + (pass ? weight : 0), 0), reasons: rules.filter(([pass]) => pass).map(([, , reason]) => reason), confirmed: mandatory });
  return {
    long: result(longRules, longRules[0][0] && longRules[2][0] && longRules[3][0] && longRules[4][0] && regime !== "bear"),
    short: result(shortRules, shortRules[0][0] && shortRules[2][0] && shortRules[3][0] && shortRules[4][0] && regime !== "bull")
  };
}

export function executionGate(verification, side, tradeDate, now) {
  const reasons = [];
  const v = verification || {};
  if (v.tradeDate !== tradeDate || !v.source || !Number.isFinite(Date.parse(v.verifiedAt)) || Date.parse(v.verifiedAt) > now.getTime()) reasons.push("缺少當日資格驗證");
  for (const key of ["adjustmentVerified", "commonStock", "dayTradeAllowed"]) if (v[key] !== true) reasons.push(`${key}: 未確認`);
  for (const key of ["disposition", "suspended", "alteredTrading"]) if (v[key] !== false) reasons.push(`${key}: 未排除`);
  if (side === "short") {
    for (const key of ["sellFirstAllowed", "brokerInventoryVerified", "shortPriceRuleVerified"]) if (v[key] !== true) reasons.push(`${key}: 未確認`);
    if (!Number.isInteger(v.availableShares) || v.availableShares <= 0) reasons.push("未確認可用券數");
    if (!Number.isFinite(v.borrowCostTwd) || v.borrowCostTwd < 0) reasons.push("未確認借券成本");
    if (!Number.isFinite(v.minimumShortPrice) || v.minimumShortPrice < 0) reasons.push("未確認放空價格限制");
  }
  return { allowed: !reasons.length, reasons };
}

function publicVerification(value) {
  if (!value) return null;
  const keys = ["tradeDate", "source", "verifiedAt", "adjustmentVerified", "commonStock", "dayTradeAllowed", "disposition", "suspended", "alteredTrading", "sellFirstAllowed", "brokerInventoryVerified", "shortPriceRuleVerified", "availableShares", "borrowCostTwd", "minimumShortPrice"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

export function buildV2Report({ ohlcv, calendar, config, tradeDate, now = new Date(), verification = {}, preview = false }) {
  assertIsoDate(tradeDate);
  const sessions = calendarSessions(calendar, Number(tradeDate.slice(0, 4)));
  const asOfDate = sessions.filter((d) => d < tradeDate).at(-1);
  const cutoff = `${tradeDate}T${config.cutoff}+08:00`;
  const report = { version: V2_VERSION, effectiveDate: V2_EFFECTIVE_DATE, tradeDate, dataDate: asOfDate, generatedAt: now.toISOString(), cutoff, timezone: "Asia/Taipei", preview, modelStatus: "strategy-v2", status: "ready", config, warnings: [], longCandidates: [], shortCandidates: [], contrarianWatchlist: [], rejected: [], sourceFiles: ["data/shared/ohlcv-history.json"], executionMode: "research-only", universeSize: Object.keys(ohlcv?.stocks || {}).length };
  if (tradeDate < V2_EFFECTIVE_DATE) report.status = "not-effective";
  else if (!sessions.includes(tradeDate)) report.status = "market-closed";
  else if (now.getTime() >= Date.parse(cutoff)) report.status = "missed-cutoff";
  else if (now.getTime() < Date.parse(`${asOfDate}T14:00:00+08:00`)) report.status = "previous-close-not-final";
  if (report.status !== "ready") { report.warnings.push(report.status); return seal(report); }
  // Official observed index sessions account for emergency closures absent
  // from the annual holiday schedule. The latest expected close must exist.
  const observedSessions = [...new Set((ohlcv?.index || []).map((b) => b.date))].sort();
  let index;
  try { index = validateSeries(ohlcv.index, observedSessions, asOfDate, config.minBars); }
  catch (e) { report.status = "data-blocked"; report.warnings.push(`指數資料未齊：${e.message}`); return seal(report); }
  const closes = index.map((b) => b.close);
  const ma20 = mean(closes.slice(-20)), ma60 = mean(closes.slice(-60));
  const regime = closes.at(-1) > ma20 && ma20 > ma60 ? "bull" : closes.at(-1) < ma20 && ma20 < ma60 ? "bear" : "neutral";
  report.regime = regime;
  for (const [key, raw] of Object.entries(ohlcv.stocks || {})) {
    if (ohlcv.meta?.universeKeys && !ohlcv.meta.universeKeys.includes(key)) continue;
    const [code, market] = key.split("|");
    const name = ohlcv.names?.[key] || "";
    if (!/^[1-8]\d{3}$/.test(code) || /-DR/.test(name)) continue;
    let bars, f;
    try {
      bars = validateSeries(raw, observedSessions, asOfDate, config.minBars);
      f = buildPreopenFeatures({ code, market, name, bars }, index, asOfDate, { ...DEFAULT_PREOPEN_CONFIG, ...config });
    } catch (e) { report.rejected.push({ code, reason: e.message }); continue; }
    if (f.close < config.minPrice || f.close > config.maxPrice || f.avgVolume20 < config.minAvgVolume20 || f.avgTurnover20 < config.minAvgTurnover20 || Math.abs(f.dailyReturnPct) >= 7) { report.rejected.push({ code, reason: "價格、量能或急漲跌門檻" }); continue; }
    const v = publicVerification(verification[key]);
    if (v?.disposition === true || v?.suspended === true || v?.alteredTrading === true) { report.rejected.push({ code, reason: "交易限制" }); continue; }
    const atr = mean(bars.slice(-14).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - bars[bars.length - 15 + i].close), Math.abs(b.low - bars[bars.length - 15 + i].close))));
    const stopPct = Math.max(config.minStopPct, Math.min(config.maxStopPct, atr / f.close * 100 * config.stopAtrMultiple));
    const scores = scoreV2(f, bars, regime);
    for (const side of ["long", "short"]) {
      const score = scores[side];
      const gate = executionGate(v, side, tradeDate, now);
      const row = { code, market, name, side, close: f.close, score: score.score, reasons: score.reasons, strategy: side === "long" ? "long-reversal" : "short-continuation", atr14: atr, stopPct, targetPct: stopPct * config.targetRiskMultiple, triggerPrice: roundToTaiwanTick(side === "long" ? bars.at(-1).high + 0.01 : bars.at(-1).low - 0.01, side === "long" ? "up" : "down"), relative5Pct: f.relative5Pct, dailyReturnPct: f.dailyReturnPct, executionEligible: gate.allowed, verification: v || null, shortTradable: false, action: gate.allowed ? "等待觸發，僅模擬" : "觀察：資格未確認", caution: gate.reasons.join("；"), predictedChangePct: null };
      if (side === "long" && score.score >= 60) report.contrarianWatchlist.push({ ...row, strategy: "contrarian-experiment", executionEligible: false, action: "跌深買進實驗觀察", caution: "僅在大盤普跌時觀察事前固定名單；不可假設跌停能成交。" });
      if (score.confirmed && score.score >= config.minScore) (side === "long" ? report.longCandidates : report.shortCandidates).push(row);
    }
  }
  const order = (a, b) => b.score - a.score || (a.side === "long" ? b.relative5Pct - a.relative5Pct : a.relative5Pct - b.relative5Pct) || a.code.localeCompare(b.code);
  const ranked = (rows, count) => rows.sort(order).slice(0, count).map((r, i) => ({ ...r, rank: i + 1 }));
  report.longCandidates = ranked(report.longCandidates, config.maxLongCandidates);
  report.shortCandidates = ranked(report.shortCandidates, config.maxShortCandidates);
  report.contrarianWatchlist = ranked(report.contrarianWatchlist, 50);
  if (regime === "bear") report.warnings.push("大盤為空頭排列，做多反轉組暫停；跌深實驗池僅觀察，不補入做多清單。");
  if (regime === "bull") report.warnings.push("大盤為多頭排列，放空延續組暫停，不為湊數逆勢放空。");
  report.dataHealth = { universe: ohlcv.meta?.universeKeys?.length || report.universeSize, rejected: report.rejected.length, historyFetchErrors: ohlcv.skipped?.length || 0, indexDate: asOfDate };
  if (report.rejected.length) report.warnings.push(`${report.rejected.length} 檔未通過資料或流動性驗證，已排除。`);
  if (ohlcv.skipped?.length) report.warnings.push(`行情抓取 ${ohlcv.skipped.length} 項失敗，覆蓋不完整。`);
  report.warnings.push("分數為條件符合度，不是勝率。原始價格未調整的候選只供觀察；資格未確認不模擬成交。", "研究股票池非完整上市櫃全市場；停牌、臨時休市與券商限制須另行確認。", "GitHub 排程可能延遲；逾 07:00 不補發可執行名單。");
  return seal(report);
}

function seal(report) {
  return { ...report, reportId: createHash("sha256").update(JSON.stringify(report)).digest("hex") };
}
