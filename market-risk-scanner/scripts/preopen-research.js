// Pre-open Taiwan stock research engine.
// Outputs research candidates only; it never places orders or marks fills.

export const PREOPEN_VERSION = "preopen-research-v1";

export const DEFAULT_PREOPEN_CONFIG = {
  maxLongCandidates: 5,
  maxShortCandidates: 10,
  minBars: 61,
  minPrice: 5,
  maxPrice: 50,
  minAvgVolume20: 500000,
  minAvgTurnover20: 10000000,
  maxAbsDailyReturnPct: 7,
  longTargetPct: 5,
  longStopPct: 3,
  shortTargetPct: 5,
  shortStopPct: 3,
  commissionRate: 0.001425,
  minCommission: 20,
  stockTaxRate: 0.003,
  dayTradeTaxRate: 0.0015,
  slippageBps: 5,
  timezone: "Asia/Taipei",
  cutoffHour: 7
};

const REQUIRED_BAR_KEYS = ["date", "open", "high", "low", "close", "volume"];

export function assertIsoDate(value, field = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a valid calendar date`);
  }
  return value;
}

export function taipeiPreopenContext(tradeDate, officialSessions, now = new Date()) {
  assertIsoDate(tradeDate, "tradeDate");
  if (!Array.isArray(officialSessions) || officialSessions.length < 2) {
    throw new Error("officialSessions must include at least two trading days");
  }
  const sessions = [...new Set(officialSessions.map((date) => assertIsoDate(date, "officialSession")))].sort();
  if (!sessions.includes(tradeDate)) {
    return { tradeDate, marketOpen: false, previousSession: sessions.filter((date) => date < tradeDate).at(-1) ?? null, cutoff: null };
  }
  const previousSession = sessions.filter((date) => date < tradeDate).at(-1);
  if (!previousSession) throw new Error("No previous trading session is available");

  const cutoff = `${tradeDate}T${String(DEFAULT_PREOPEN_CONFIG.cutoffHour).padStart(2, "0")}:00:00+08:00`;
  return {
    tradeDate,
    marketOpen: true,
    previousSession,
    cutoff,
    generatedAt: now.toISOString(),
    timezone: DEFAULT_PREOPEN_CONFIG.timezone
  };
}

export function taiwanTickSize(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) throw new Error("price must be positive");
  if (value < 10) return 0.01;
  if (value < 50) return 0.05;
  if (value < 100) return 0.1;
  if (value < 500) return 0.5;
  if (value < 1000) return 1;
  return 5;
}

export function roundToTaiwanTick(price, mode = "nearest") {
  const tick = taiwanTickSize(price);
  const value = Number(price);
  const scaled = value / tick;
  if (mode === "down") return Number((Math.floor(scaled) * tick).toFixed(2));
  if (mode === "up") return Number((Math.ceil(scaled) * tick).toFixed(2));
  return Number((Math.round(scaled) * tick).toFixed(2));
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(from, to) {
  return (to / from - 1) * 100;
}

function sma(values, period) {
  return avg(values.slice(-period));
}

function linearSlope(values) {
  const n = values.length;
  const xAvg = (n - 1) / 2;
  const yAvg = avg(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xAvg) * (values[i] - yAvg);
    denominator += (i - xAvg) ** 2;
  }
  return denominator ? numerator / denominator : 0;
}

function validBar(bar) {
  for (const key of REQUIRED_BAR_KEYS) {
    if (bar[key] == null) return false;
  }
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  const volume = Number(bar.volume);
  return [open, high, low, close, volume].every(Number.isFinite)
    && open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0
    && high >= Math.max(open, close, low)
    && low <= Math.min(open, close, high);
}

export function buildPreopenFeatures(stock, indexBars, asOfDate, config = DEFAULT_PREOPEN_CONFIG) {
  assertIsoDate(asOfDate, "asOfDate");
  if (!stock || !Array.isArray(stock.bars)) throw new Error("stock.bars is required");
  const bars = stock.bars.filter((bar) => bar.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  if (bars.some((bar) => !validBar(bar))) throw new Error(`Invalid OHLCV data for ${stock.code || "unknown"}`);
  if (bars.length < config.minBars) throw new Error(`Need at least ${config.minBars} bars`);
  if (bars.at(-1).date !== asOfDate) throw new Error(`Latest stock bar is not asOfDate ${asOfDate}`);

  const index = (indexBars || []).filter((bar) => bar.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  if (index.length < config.minBars || index.at(-1).date !== asOfDate) {
    throw new Error(`Index data must be aligned through ${asOfDate}`);
  }

  const closes = bars.map((bar) => Number(bar.close));
  const volumes = bars.map((bar) => Number(bar.volume));
  const latest = bars.at(-1);
  const prior = bars.at(-2);
  const indexCloses = index.map((bar) => Number(bar.close));
  const avgVolume20 = avg(volumes.slice(-20));
  const avgTurnover20 = avg(bars.slice(-20).map((bar) => Number(bar.close) * Number(bar.volume)));
  const stockReturn5 = pct(closes.at(-6), closes.at(-1));
  const indexReturn5 = pct(indexCloses.at(-6), indexCloses.at(-1));
  const stockReturn20 = pct(closes.at(-21), closes.at(-1));
  const indexReturn20 = pct(indexCloses.at(-21), indexCloses.at(-1));

  let upVolume = 0;
  let downVolume = 0;
  for (const bar of bars.slice(-10)) {
    if (Number(bar.close) >= Number(bar.open)) upVolume += Number(bar.volume);
    else downVolume += Number(bar.volume);
  }

  return {
    code: String(stock.code),
    name: stock.name || "",
    market: stock.market || "",
    asOfDate,
    close: Number(latest.close),
    dailyReturnPct: pct(Number(prior.close), Number(latest.close)),
    return5Pct: stockReturn5,
    return20Pct: stockReturn20,
    relative5Pct: stockReturn5 - indexReturn5,
    relative20Pct: stockReturn20 - indexReturn20,
    ma5: sma(closes, 5),
    ma20: sma(closes, 20),
    ma60: sma(closes, 60),
    slope10: linearSlope(closes.slice(-10)),
    priorHigh20: Math.max(...bars.slice(-21, -1).map((bar) => Number(bar.high))),
    priorLow20: Math.min(...bars.slice(-21, -1).map((bar) => Number(bar.low))),
    avgVolume20,
    avgTurnover20,
    volumeBalance10: upVolume - downVolume,
    adjustmentVerified: stock.adjustmentVerified === true,
    commonStock: stock.commonStock !== false,
    disposition: stock.disposition === true,
    suspended: stock.suspended === true,
    alteredTrading: stock.alteredTrading === true,
    dayTradeAllowed: stock.dayTradeAllowed === true,
    sellFirstAllowed: stock.sellFirstAllowed === true,
    marginShortAllowed: stock.marginShortAllowed === true,
    brokerInventoryVerified: stock.brokerInventoryVerified === true
  };
}

export function preopenEligibility(features, side, mode = "intraday", config = DEFAULT_PREOPEN_CONFIG) {
  const reasons = [];
  if (!features.commonStock) reasons.push("非普通股");
  if (!features.adjustmentVerified) reasons.push("價格未確認除權息調整");
  if (features.close < config.minPrice || features.close > config.maxPrice) reasons.push(`價格不在 ${config.minPrice}-${config.maxPrice}`);
  if (features.avgVolume20 < config.minAvgVolume20) reasons.push("20 日均量不足");
  if (features.avgTurnover20 < config.minAvgTurnover20) reasons.push("20 日均成交值不足");
  if (Math.abs(features.dailyReturnPct) > config.maxAbsDailyReturnPct) reasons.push("單日漲跌幅過大");
  if (features.disposition) reasons.push("處置股");
  if (features.suspended) reasons.push("停止交易");
  if (features.alteredTrading) reasons.push("變更交易或特殊限制");
  if (mode === "intraday" && !features.dayTradeAllowed) reasons.push("不可現股當沖");
  if (side === "short" && mode === "intraday" && !features.sellFirstAllowed) reasons.push("不可先賣後買");
  if (side === "short" && mode === "swing" && !features.marginShortAllowed) reasons.push("不可融券放空");

  return {
    passed: reasons.length === 0,
    reasons,
    brokerInventoryVerified: features.brokerInventoryVerified
  };
}

export function scoreLongReversal(features) {
  const reasons = [];
  let score = 0;
  if (features.close > features.ma5 && features.ma5 > features.ma20) { score += 18; reasons.push("短線站回強勢排列"); }
  if (features.slope10 > 0) { score += 16; reasons.push("10 日斜率轉正"); }
  if (features.close > features.priorLow20 * 1.04) { score += 14; reasons.push("脫離 20 日低點"); }
  if (features.return5Pct > -1 && features.return20Pct < 0) { score += 14; reasons.push("下跌後轉穩"); }
  if (features.relative5Pct > 0) { score += 14; reasons.push("5 日相對大盤轉強"); }
  if (features.volumeBalance10 > 0) { score += 12; reasons.push("近 10 日上漲量較強"); }
  if (features.close > features.ma60 * 0.92) { score += 12; reasons.push("未嚴重偏離季線"); }
  return { side: "long", score: Number(Math.min(100, score).toFixed(2)), reasons, passed: score >= 60 };
}

export function scoreShortContinuation(features) {
  const reasons = [];
  let score = 0;
  if (features.close < features.ma5 && features.ma5 < features.ma20) { score += 20; reasons.push("短線空頭排列"); }
  if (features.slope10 < 0) { score += 16; reasons.push("10 日斜率向下"); }
  if (features.close < features.priorLow20 * 1.02) { score += 14; reasons.push("逼近或跌破 20 日低點"); }
  if (features.return5Pct < 0 && features.return20Pct < 0) { score += 14; reasons.push("5/20 日同步轉弱"); }
  if (features.relative5Pct < 0 && features.relative20Pct < 0) { score += 14; reasons.push("相對大盤落後"); }
  if (features.volumeBalance10 < 0) { score += 12; reasons.push("下跌量較強"); }
  if (features.close < features.ma60) { score += 10; reasons.push("跌破季線"); }
  return { side: "short", score: Number(Math.min(100, score).toFixed(2)), reasons, passed: score >= 60 };
}

export function netTradeReturn({ side, entryPrice, exitPrice, shares = 1000, dayTrade = false, config = DEFAULT_PREOPEN_CONFIG }) {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const quantity = Number(shares);
  if (entry <= 0 || exit <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("entryPrice, exitPrice, and integer shares are required");
  }
  const entryNotional = entry * quantity;
  const exitNotional = exit * quantity;
  const buyNotional = side === "short" ? exitNotional : entryNotional;
  const sellNotional = side === "short" ? entryNotional : exitNotional;
  const commission = Math.max(config.minCommission, entryNotional * config.commissionRate)
    + Math.max(config.minCommission, exitNotional * config.commissionRate);
  const tax = sellNotional * (dayTrade ? config.dayTradeTaxRate : config.stockTaxRate);
  const gross = side === "short" ? entryNotional - exitNotional : exitNotional - entryNotional;
  const net = gross - commission - tax;
  return {
    gross: Number(gross.toFixed(2)),
    commission: Number(commission.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    net: Number(net.toFixed(2)),
    netReturnPct: Number((net / buyNotional * 100).toFixed(2))
  };
}

export function simulateNextOpenPlan(signal, forwardBars, config = DEFAULT_PREOPEN_CONFIG) {
  if (!Array.isArray(forwardBars) || !forwardBars.length) throw new Error("forwardBars are required");
  const side = signal.side;
  const entryBar = forwardBars[0];
  if (entryBar.date <= signal.asOfDate) throw new Error("entry must be after signal asOfDate");
  if (!validBar(entryBar)) throw new Error("invalid entry bar");
  if (Number(entryBar.high) === Number(entryBar.low)) {
    return { filled: false, reason: "locked-limit", entryDate: entryBar.date };
  }
  const slippage = config.slippageBps / 10000;
  const entryPrice = side === "short"
    ? roundToTaiwanTick(Number(entryBar.open) * (1 - slippage), "down")
    : roundToTaiwanTick(Number(entryBar.open) * (1 + slippage), "up");
  const targetPct = side === "short" ? config.shortTargetPct : config.longTargetPct;
  const stopPct = side === "short" ? config.shortStopPct : config.longStopPct;
  const targetPrice = side === "short"
    ? roundToTaiwanTick(entryPrice * (1 - targetPct / 100), "up")
    : roundToTaiwanTick(entryPrice * (1 + targetPct / 100), "down");
  const stopPrice = side === "short"
    ? roundToTaiwanTick(entryPrice * (1 + stopPct / 100), "up")
    : roundToTaiwanTick(entryPrice * (1 - stopPct / 100), "down");

  let exitPrice = Number(forwardBars.at(-1).close);
  let exitReason = "time";
  let exitDate = forwardBars.at(-1).date;
  for (const bar of forwardBars) {
    if (!validBar(bar)) throw new Error("invalid forward bar");
    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    if (side === "long") {
      if (open <= stopPrice) { exitPrice = open; exitReason = "gap-stop"; exitDate = bar.date; break; }
      if (low <= stopPrice) { exitPrice = stopPrice; exitReason = "stop"; exitDate = bar.date; break; }
      if (high >= targetPrice) { exitPrice = targetPrice; exitReason = "target"; exitDate = bar.date; break; }
    } else {
      if (open >= stopPrice) { exitPrice = open; exitReason = "gap-stop"; exitDate = bar.date; break; }
      if (high >= stopPrice) { exitPrice = stopPrice; exitReason = "stop"; exitDate = bar.date; break; }
      if (low <= targetPrice) { exitPrice = targetPrice; exitReason = "target"; exitDate = bar.date; break; }
    }
  }
  const costs = netTradeReturn({ side, entryPrice, exitPrice, shares: signal.shares || 1000, dayTrade: signal.dayTrade === true, config });
  return {
    filled: true,
    side,
    entryDate: entryBar.date,
    entryPrice,
    targetPrice,
    stopPrice,
    exitDate,
    exitPrice: Number(exitPrice.toFixed(2)),
    exitReason,
    ...costs
  };
}

export function rankPreopenCandidates(stocks, indexBars, asOfDate, config = DEFAULT_PREOPEN_CONFIG) {
  const long = [];
  const short = [];
  for (const stock of stocks) {
    let features;
    try {
      features = buildPreopenFeatures(stock, indexBars, asOfDate, config);
    } catch (error) {
      continue;
    }
    const longScore = scoreLongReversal(features);
    const longEligibility = preopenEligibility(features, "long", "intraday", config);
    if (longScore.passed && longEligibility.passed) {
      long.push({ ...pickCandidateFields(features), score: longScore.score, reasons: longScore.reasons, side: "long" });
    }
    const shortScore = scoreShortContinuation(features);
    const shortEligibility = preopenEligibility(features, "short", "intraday", config);
    if (shortScore.passed && shortEligibility.passed) {
      short.push({ ...pickCandidateFields(features), score: shortScore.score, reasons: shortScore.reasons, side: "short", brokerInventoryVerified: shortEligibility.brokerInventoryVerified });
    }
  }
  return {
    version: PREOPEN_VERSION,
    asOfDate,
    generatedAt: new Date().toISOString(),
    config: {
      maxLongCandidates: config.maxLongCandidates,
      maxShortCandidates: config.maxShortCandidates,
      maxPrice: config.maxPrice,
      minAvgVolume20: config.minAvgVolume20,
      minAvgTurnover20: config.minAvgTurnover20
    },
    long: long.sort((a, b) => b.score - a.score).slice(0, config.maxLongCandidates).map((item, index) => ({ rank: index + 1, ...item })),
    short: short.sort((a, b) => b.score - a.score).slice(0, config.maxShortCandidates).map((item, index) => ({ rank: index + 1, ...item }))
  };
}

function pickCandidateFields(features) {
  return {
    code: features.code,
    name: features.name,
    market: features.market,
    close: features.close,
    dailyReturnPct: Number(features.dailyReturnPct.toFixed(2)),
    return5Pct: Number(features.return5Pct.toFixed(2)),
    relative5Pct: Number(features.relative5Pct.toFixed(2)),
    avgVolume20: Math.round(features.avgVolume20),
    avgTurnover20: Math.round(features.avgTurnover20)
  };
}
