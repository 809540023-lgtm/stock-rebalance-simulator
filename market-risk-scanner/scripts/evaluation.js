// Long-term evaluation of candidate signals.
// Pure functions so they can be unit-tested without network access.
// All returns are research metrics, not investment advice.

// Fee assumptions (per PROJECT_STATE.md): commission 0.1425% per side and
// 0.3% normal-sale transaction tax. Net return subtracts both sides of
// commission plus the sale tax.
export const FEE_RATE = 0.001425 * 2 + 0.003; // ~0.585%

// Default target/stop distances from the entry price.
export const TARGET_PCT = 0.05;
export const STOP_PCT = 0.05;

// Builds a single trade record from a signal and its forward daily bars.
// signal: { signalDate, model, code, name, market, entryPrice }
// forward: array of { date, close, high, low } for the days after the signal,
//          sorted ascending by date. Must include at least one bar.
// Returns the trade record with 3/5/20-day returns, MFE, MAE, exit, and net return.
export function buildTradeRecord(signal, forward) {
  const entry = Number(signal.entryPrice);
  const bullish = signal.model === "bullish";
  const target = bullish ? entry * (1 + TARGET_PCT) : entry * (1 - TARGET_PCT);
  const stop = bullish ? entry * (1 - STOP_PCT) : entry * (1 + STOP_PCT);

  let exitPrice = null;
  let exitReason = "time";
  let exitIndex = forward.length - 1;
  for (let i = 0; i < forward.length; i += 1) {
    const bar = forward[i];
    const high = Number(bar.high) || Number(bar.close);
    const low = Number(bar.low) || Number(bar.close);
    if (bullish && high >= target) { exitPrice = target; exitReason = "target"; exitIndex = i; break; }
    if (bullish && low <= stop) { exitPrice = stop; exitReason = "stop"; exitIndex = i; break; }
    if (!bullish && low <= target) { exitPrice = target; exitReason = "target"; exitIndex = i; break; }
    if (!bullish && high >= stop) { exitPrice = stop; exitReason = "stop"; exitIndex = i; break; }
  }
  if (exitPrice === null) exitPrice = Number(forward.at(-1).close);

  // MFE / MAE in percent of entry.
  let mfe = 0;
  let mae = 0;
  for (const bar of forward) {
    const high = Number(bar.high) || Number(bar.close);
    const low = Number(bar.low) || Number(bar.close);
    if (bullish) {
      mfe = Math.max(mfe, (high - entry) / entry * 100);
      mae = Math.max(mae, (entry - low) / entry * 100);
    } else {
      mfe = Math.max(mfe, (entry - low) / entry * 100);
      mae = Math.max(mae, (high - entry) / entry * 100);
    }
  }

  const grossReturn = bullish ? (exitPrice / entry - 1) * 100 : (1 - exitPrice / entry) * 100;
  const netReturn = grossReturn - FEE_RATE * 100;

  const closeAt = (offset) => {
    const bar = forward[offset];
    if (!bar) return null;
    const pct = bullish ? (Number(bar.close) / entry - 1) * 100 : (1 - Number(bar.close) / entry) * 100;
    return { close: Number(bar.close), returnPct: Number(pct.toFixed(2)) };
  };

  return {
    signalDate: signal.signalDate,
    model: signal.model,
    code: signal.code,
    name: signal.name,
    market: signal.market,
    entryPrice: entry,
    targetPrice: Number(target.toFixed(2)),
    stopPrice: Number(stop.toFixed(2)),
    mfe: Number(mfe.toFixed(2)),
    mae: Number(mae.toFixed(2)),
    exitReason,
    exitPrice: Number(exitPrice.toFixed(2)),
    exitIndex,
    grossReturn: Number(grossReturn.toFixed(2)),
    netReturn: Number(netReturn.toFixed(2)),
    forward3d: closeAt(2),
    forward5d: closeAt(4),
    forward20d: closeAt(19)
  };
}

// Summarizes a set of trade records into aggregate performance metrics.
// Returns { sampleSize, winRate, avgNetReturn, profitFactor, maxDrawdown, totalReturn }.
export function summarizeTrades(trades) {
  const netReturns = trades.map((trade) => Number(trade.netReturn) || 0);
  const sampleSize = netReturns.length;
  if (!sampleSize) {
    return { sampleSize: 0, winRate: 0, avgNetReturn: 0, profitFactor: 0, maxDrawdown: 0, totalReturn: 0 };
  }
  const wins = netReturns.filter((value) => value > 0);
  const losses = netReturns.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Max drawdown of the running average net return (percentage scale).
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (let i = 0; i < netReturns.length; i += 1) {
    cumulative += netReturns[i];
    const runningAvg = cumulative / (i + 1);
    peak = Math.max(peak, runningAvg);
    maxDrawdown = Math.max(maxDrawdown, peak - runningAvg);
  }

  return {
    sampleSize,
    winRate: Number((wins.length / sampleSize * 100).toFixed(2)),
    avgNetReturn: Number((netReturns.reduce((sum, value) => sum + value, 0) / sampleSize).toFixed(2)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : profitFactor,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    totalReturn: Number(cumulative.toFixed(2))
  };
}

// Compares a model's average net return against the index and a baseline.
// Returns a comparison object with the model's edge over each benchmark.
export function compareToBaseline(modelSummary, indexSummary, baselineSummary) {
  return {
    modelAvgNetReturn: modelSummary.avgNetReturn,
    indexAvgReturn: indexSummary?.avgNetReturn ?? null,
    baselineAvgNetReturn: baselineSummary?.avgNetReturn ?? null,
    edgeVsIndex: modelSummary.avgNetReturn - (indexSummary?.avgNetReturn ?? 0),
    edgeVsBaseline: modelSummary.avgNetReturn - (baselineSummary?.avgNetReturn ?? 0)
  };
}
