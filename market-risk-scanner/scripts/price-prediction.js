// Simple ML-style price prediction (concept ported from
// scorpionhiccup/StockPricePrediction). Uses ordinary least-squares linear
// regression on recent closes to estimate the next close and direction.
// Pure functions so they can be unit-tested. Research only, not investment advice.

// Fits a line y = a + b*x over the last `window` closes and returns the
// predicted next close. Returns null if there are too few points.
export function predictNextPrice(closes, window = 10) {
  const series = closes.slice(-window);
  if (series.length < 3) return null;
  const n = series.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = series.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (x[i] - meanX) * (series[i] - meanY);
    den += (x[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return Number((intercept + slope * n).toFixed(2));
}

// Predicted direction: 1 = up, -1 = down, 0 = flat/unknown.
export function predictDirection(closes, window = 10) {
  const last = closes.at(-1);
  const predicted = predictNextPrice(closes, window);
  if (predicted == null || last == null) return 0;
  const pct = (predicted / last - 1) * 100;
  if (Math.abs(pct) < 0.1) return 0;
  return pct > 0 ? 1 : -1;
}

// Predicted change in percent from the latest close.
export function predictChangePct(closes, window = 10) {
  const last = closes.at(-1);
  const predicted = predictNextPrice(closes, window);
  if (predicted == null || last == null) return null;
  return Number(((predicted / last - 1) * 100).toFixed(2));
}
