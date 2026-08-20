// Deterministic bullish-reversal and bearish-continuation models.
// These are separate from the decline-risk score and are NOT buy/sell orders.
// All functions are pure so they can be unit-tested without network access.
import { rsi, macd, bollinger } from "./technical-indicators.js";

export const DEFAULT_CONFIG = {
  // Minimum number of daily bars required to score a stock.
  minTradingDays: 10,
  // Liquidity: minimum average daily volume (shares) over the window.
  minAvgVolume: 500000,
  // Price ceiling: exclude stocks whose latest close is above this price.
  maxPrice: 50,
  // Avoid chasing: exclude a bullish candidate whose latest close is more
  // than this percentage above its 10-day moving average.
  maxChasePct: 15,
  // Relative-strength window used to compare a stock against the index.
  rsWindow: 5,
  // A candidate snapshot is considered stale when its data date is older
  // than this many calendar days.
  staleAfterDays: 1
};

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lastReturn(closes, window) {
  if (closes.length < window + 1) return null;
  return (closes.at(-1) / closes.at(-1 - window) - 1) * 100;
}

// Computes the latest technical-indicator states for a series of closes.
function technicalSignals(closes) {
  if (closes.length < 20) return { rsi: null, macdHist: null, bb: null };
  const r = rsi(closes);
  const m = macd(closes);
  const b = bollinger(closes);
  const last = closes.at(-1);
  return {
    rsi: r.at(-1),
    macdHist: m.hist.at(-1),
    bb: b.middle.at(-1) != null ? { mid: b.middle.at(-1), upper: b.upper.at(-1), lower: b.lower.at(-1), price: last } : null
  };
}

// Returns { score, reasons, passed } for a bullish reversal confirmation.
// series: [{ date, close, volume }] sorted ascending by date.
// indexCloses: array of index closes aligned to the same trading days.
// fundamental: { pe, dividendYield, pb } or null.
export function computeBullishScore(series, indexCloses, fundamental) {
  const closes = series.map((item) => item.close);
  const volumes = series.map((item) => item.volume);
  const n = closes.length;
  if (n < DEFAULT_CONFIG.minTradingDays) {
    return { score: 0, reasons: ["資料不足"], passed: false };
  }

  const reasons = [];
  let score = 0;
  const last = closes[n - 1];
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma5Now = ma5[n - 1];
  const ma10Now = ma10[n - 1];
  const ma5Prev = ma5[n - 2];

  // 1. Stabilization: latest close is not a new recent low.
  const recentLow = Math.min(...closes.slice(-5));
  if (last > recentLow) {
    score += 15;
    reasons.push("近期未創新低");
  } else {
    reasons.push("仍在近期低點附近");
  }

  // 2. Higher low: recent 5-day low is above the prior 5-day low.
  const priorLow = Math.min(...closes.slice(-10, -5));
  if (recentLow > priorLow) {
    score += 15;
    reasons.push("低點墊高");
  }

  // 3. Short moving averages turning up.
  if (ma5Now > ma10Now) {
    score += 20;
    reasons.push("短均線轉多");
  }
  if (ma5Now > ma5Prev) {
    score += 10;
    reasons.push("短均線上揚");
  }

  // 4. Price above the short moving average.
  if (last > ma5Now) {
    score += 10;
    reasons.push("站上短均線");
  }

  // 5. Improving up-volume: recent up-day volume exceeds down-day volume.
  const recent = series.slice(-5);
  let upVol = 0;
  let downVol = 0;
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i].close >= recent[i - 1].close) upVol += recent[i].volume;
    else downVol += recent[i].volume;
  }
  if (upVol > downVol) {
    score += 10;
    reasons.push("上漲量能改善");
  }

  // 6. Relative strength vs the index over the RS window.
  const stockRs = lastReturn(closes, DEFAULT_CONFIG.rsWindow);
  const indexRs = indexCloses && indexCloses.length > DEFAULT_CONFIG.rsWindow
    ? lastReturn(indexCloses, DEFAULT_CONFIG.rsWindow)
    : null;
  if (stockRs !== null && indexRs !== null && stockRs > indexRs) {
    score += 10;
    reasons.push("相對大盤強勢");
  }

  // 7. Acceptable fundamentals.
  const fundamentalScore = fundamentalRiskScore(fundamental);
  if (fundamentalScore <= 30) {
    score += 10;
    reasons.push("基本面可接受");
  } else {
    reasons.push("基本面偏弱");
  }

  // 8. Technical indicators (RSI / MACD / Bollinger).
  const tech = technicalSignals(closes);
  if (tech.rsi != null && tech.rsi > 50 && tech.rsi < 75) { score += 5; reasons.push("RSI 走強"); }
  if (tech.macdHist != null && tech.macdHist > 0) { score += 5; reasons.push("MACD 轉多"); }
  if (tech.bb && tech.bb.price >= tech.bb.mid) { score += 5; reasons.push("站上布林中軌"); }

  return { score: Number(Math.min(100, score).toFixed(2)), reasons, passed: score >= 60 };
}

// Returns { score, reasons, passed } for a bearish continuation candidate.
export function computeBearishScore(series, indexCloses, fundamental) {
  const closes = series.map((item) => item.close);
  const volumes = series.map((item) => item.volume);
  const n = closes.length;
  if (n < DEFAULT_CONFIG.minTradingDays) {
    return { score: 0, reasons: ["資料不足"], passed: false };
  }

  const reasons = [];
  let score = 0;
  const last = closes[n - 1];
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma5Now = ma5[n - 1];
  const ma10Now = ma10[n - 1];

  // 1. Price below both short moving averages.
  if (last < ma5Now && last < ma10Now) {
    score += 20;
    reasons.push("跌破短均線");
  } else {
    reasons.push("未跌破短均線");
  }

  // 2. Lower low: recent 5-day low is below the prior 5-day low.
  const recentLow = Math.min(...closes.slice(-5));
  const priorLow = Math.min(...closes.slice(-10, -5));
  if (recentLow < priorLow) {
    score += 15;
    reasons.push("低點下移");
  }

  // 3. Recent weakness: negative short-term return.
  const shortReturn = lastReturn(closes, 5);
  if (shortReturn !== null && shortReturn < 0) {
    score += 15;
    reasons.push("近期走弱");
  }

  // 4. Failed rebound: price below short MAs after a bounce attempt.
  const recentHigh = Math.max(...closes.slice(-5));
  if (recentHigh > ma10Now && last < ma5Now) {
    score += 15;
    reasons.push("反彈失敗");
  }

  // 5. Down-volume confirmation: recent down-day volume exceeds up-day volume.
  const recent = series.slice(-5);
  let upVol = 0;
  let downVol = 0;
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i].close >= recent[i - 1].close) upVol += recent[i].volume;
    else downVol += recent[i].volume;
  }
  if (downVol > upVol) {
    score += 15;
    reasons.push("下跌量能放大");
  }

  // 6. Liquidity sufficient to trade.
  const avgVolume = avg(volumes);
  if (avgVolume >= DEFAULT_CONFIG.minAvgVolume) {
    score += 10;
    reasons.push("流動性充足");
  }

  // 7. Breakdown trigger defined: a conditional trigger below the latest close.
  const trigger = last * 0.99;
  if (trigger < last) {
    score += 10;
    reasons.push(`跌破 ${trigger.toFixed(2)} 觸發`);
  }

  // 8. Technical indicators (RSI / MACD / Bollinger) for bearish confirmation.
  const tech = technicalSignals(closes);
  if (tech.rsi != null && tech.rsi < 50 && tech.rsi > 25) { score += 5; reasons.push("RSI 轉弱"); }
  if (tech.macdHist != null && tech.macdHist < 0) { score += 5; reasons.push("MACD 走空"); }
  if (tech.bb && tech.bb.price <= tech.bb.mid) { score += 5; reasons.push("跌破布林中軌"); }

  return { score: Number(Math.min(100, score).toFixed(2)), reasons, passed: score >= 60 };
}

// Filters that gate whether a stock may appear in a candidate list.
// Returns { passed, reasons, tradingEligible }.
export function applyFilters(stock, dispositionSet, config = DEFAULT_CONFIG) {
  const reasons = [];
  const avgVolume = Number(stock.avgVolume) || 0;
  const last = Number(stock.endPrice) || 0;
  const ma10 = Number(stock.ma10) || 0;
  const disposition = Boolean(dispositionSet && dispositionSet.has(String(stock.code)));
  const enoughData = stock.tradingDays + 1 >= config.minTradingDays;

  if (config.maxPrice != null && last > config.maxPrice) {
    reasons.push(`價格超過上限 ${config.maxPrice}`);
  }
  if (avgVolume < config.minAvgVolume) {
    reasons.push(`日均量不足 ${config.minAvgVolume}`);
  }
  if (disposition) {
    reasons.push("處置股");
  }
  if (ma10 > 0 && last > ma10 * (1 + config.maxChasePct / 100)) {
    reasons.push("漲幅已高不宜追價");
  }
  if (!enoughData) {
    reasons.push("交易日不足");
  }

  // Trading eligibility: not under disposition, has enough data, and has
  // sufficient liquidity to trade.
  const tradingEligible = !disposition && enoughData && avgVolume >= config.minAvgVolume;
  return { passed: reasons.length === 0, reasons, tradingEligible };
}

// Returns { stale, warning } for a candidate snapshot. A snapshot is stale
// when its data date is older than config.staleAfterDays calendar days.
export function staleness(dataDate, generatedAt, config = DEFAULT_CONFIG) {
  const date = new Date(`${String(dataDate)}T00:00:00Z`);
  const generated = new Date(generatedAt);
  if (Number.isNaN(date.getTime()) || Number.isNaN(generated.getTime())) {
    return { stale: true, warning: "資料日期或產生時間無效" };
  }
  const days = Math.floor((generated - date) / 86400000);
  if (days > config.staleAfterDays) {
    return { stale: true, warning: `資料日期 ${dataDate} 已超過 ${days} 天，可能已過期` };
  }
  return { stale: false, warning: null };
}

function fundamentalRiskScore(fundamental) {
  if (!fundamental) return 40;
  let score = 0;
  if (!Number.isFinite(fundamental.pe) || fundamental.pe <= 0) score += 30;
  else if (fundamental.pe > 40) score += 20;
  if (!Number.isFinite(fundamental.dividendYield)) score += 15;
  else if (fundamental.dividendYield < 1) score += 10;
  if (!Number.isFinite(fundamental.pb) || fundamental.pb <= 0) score += 20;
  else if (fundamental.pb > 4) score += 20;
  return Math.min(100, score);
}
