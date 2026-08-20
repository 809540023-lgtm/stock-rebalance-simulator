// Technical analysis indicators (concepts from TA-Lib / Pandas TA).
// Pure functions, unit-testable, no network access. Research only.

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

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    if (prev == null) prev = values[i];
    else prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// RSI (Wilder's). Returns an array with the latest value last, or null values.
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

// MACD. Returns { macd, signal, hist } arrays aligned to closes.
export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null));
  const valid = line.slice(slow - 1);
  const sig = ema(valid, signalPeriod);
  const signal = new Array(closes.length).fill(null);
  const hist = new Array(closes.length).fill(null);
  for (let i = 0; i < valid.length; i += 1) {
    signal[i + slow - 1] = sig[i];
    if (line[i + slow - 1] != null && sig[i] != null) hist[i + slow - 1] = line[i + slow - 1] - sig[i];
  }
  return { macd: line, signal, hist };
}

// KDJ stochastic oscillator. Returns { k, d, j } arrays.
export function kdj(highs, lows, closes, period = 9) {
  const k = new Array(closes.length).fill(50);
  const d = new Array(closes.length).fill(50);
  const j = new Array(closes.length).fill(50);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < closes.length; i += 1) {
    const start = Math.max(0, i - period + 1);
    const hh = Math.max(...highs.slice(start, i + 1));
    const ll = Math.min(...lows.slice(start, i + 1));
    const rsv = hh === ll ? 50 : (closes[i] - ll) / (hh - ll) * 100;
    const curK = (2 / 3) * prevK + (1 / 3) * rsv;
    const curD = (2 / 3) * prevD + (1 / 3) * curK;
    k[i] = curK;
    d[i] = curD;
    j[i] = 3 * curK - 2 * curD;
    prevK = curK;
    prevD = curD;
  }
  return { k, d, j };
}

// Bollinger Bands. Returns { upper, mid, lower } arrays.
export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle: mid, lower };
}
