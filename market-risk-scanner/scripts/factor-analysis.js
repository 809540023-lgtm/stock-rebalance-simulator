// Factor performance analysis (concept ported from quantopian/alphalens).
// Evaluates whether a factor value (e.g., the bullish/bearish score) predicts
// forward returns. Pure functions so they can be unit-tested.
// Research metrics only, not investment advice.

function rank(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length).fill(0);
  for (let i = 0; i < order.length; i += 1) ranks[order[i].index] = i + 1;
  return ranks;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const n = a.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

// Information Coefficient: Spearman (rank) correlation between factor values
// and forward returns. Returns { ic, sampleSize } or { ic: null } if invalid.
export function computeIC(factorValues, forwardReturns) {
  const pairs = factorValues.map((value, index) => [value, forwardReturns[index]])
    .filter(([value, ret]) => Number.isFinite(value) && Number.isFinite(ret));
  if (pairs.length < 3) return { ic: null, sampleSize: pairs.length };
  const rankFactor = rank(pairs.map(([f]) => f));
  const rankReturn = rank(pairs.map(([, r]) => r));
  return { ic: Number(pearson(rankFactor, rankReturn).toFixed(4)), sampleSize: pairs.length };
}

// Average forward return by factor quantile (e.g. 5 buckets). Returns an array
// of { quantile, avgReturn, count } sorted by quantile (1 = lowest factor).
export function quantileReturns(factorValues, forwardReturns, nQuantiles = 5) {
  const pairs = factorValues.map((value, index) => [value, forwardReturns[index]])
    .filter(([value, ret]) => Number.isFinite(value) && Number.isFinite(ret));
  if (pairs.length < nQuantiles) return [];
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const buckets = Array.from({ length: nQuantiles }, () => []);
  sorted.forEach(([factor, ret], index) => {
    const q = Math.min(nQuantiles - 1, Math.floor(index * nQuantiles / sorted.length));
    buckets[q].push(ret);
  });
  return buckets.map((bucket, index) => ({
    quantile: index + 1,
    avgReturn: Number((bucket.reduce((sum, v) => sum + v, 0) / bucket.length).toFixed(2)),
    count: bucket.length
  }));
}

// Spread: average return of the top quantile minus the bottom quantile.
export function quantileSpread(quantiles) {
  if (quantiles.length < 2) return null;
  const top = quantiles.at(-1);
  const bottom = quantiles[0];
  return Number((top.avgReturn - bottom.avgReturn).toFixed(2));
}
