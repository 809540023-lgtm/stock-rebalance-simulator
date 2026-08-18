// Saves the latest bullish and bearish candidate snapshots to data/shared/.
// The "latest" files are overwritten each run; the "history" files accumulate
// one record per data date and never overwrite an earlier snapshot.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { staleness } from "./models.js";

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);

// Default maximum number of candidates kept per model snapshot.
export const DEFAULT_MAX_CANDIDATES = 50;

function pickCandidate(row, scoreKey) {
  return {
    market: row.market,
    code: row.code,
    name: row.name,
    endPrice: row.endPrice,
    score: row[`${scoreKey}Score`],
    reasons: row.reasons || [],
    tradingEligible: Boolean(row.tradingEligible)
  };
}

// Builds the latest-snapshot payloads for both models from market-risk.json.
export function buildCandidateFiles(marketData, config) {
  const dataDate = marketData.range?.end || null;
  const generatedAt = marketData.generatedAt || new Date().toISOString();
  const stale = staleness(dataDate, generatedAt, config);
  const max = Math.max(1, Number(config?.maxCandidates) || DEFAULT_MAX_CANDIDATES);
  const bullish = (marketData.candidates?.bullish || [])
    .map((row) => pickCandidate(row, "bullish"))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  const bearish = (marketData.candidates?.bearish || [])
    .map((row) => pickCandidate(row, "bearish"))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  return {
    bullish: {
      generatedAt,
      dataDate,
      stale: stale.stale,
      staleWarning: stale.warning,
      count: bullish.length,
      candidates: bullish
    },
    bearish: {
      generatedAt,
      dataDate,
      stale: stale.stale,
      staleWarning: stale.warning,
      count: bearish.length,
      candidates: bearish
    }
  };
}

// Merges a new record into an existing history, keeping the first record per
// data date so earlier snapshots are never overwritten.
export function mergeHistory(existing, newRecord) {
  const records = Array.isArray(existing?.records) ? existing.records : [];
  const seen = new Set(records.map((record) => record.date));
  if (newRecord.date && !seen.has(newRecord.date)) {
    records.push(newRecord);
  }
  return { records };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function saveSharedCandidates(marketData, config) {
  const files = buildCandidateFiles(marketData, config);
  await mkdir(SHARED_DIR, { recursive: true });
  const results = [];
  for (const [key, label] of [["bullish", "bullish"], ["bearish", "bearish"]]) {
    const latestPath = new URL(`${key}-latest.json`, SHARED_DIR);
    const historyPath = new URL(`${key}-history.json`, SHARED_DIR);
    await writeFile(latestPath, JSON.stringify(files[key], null, 2), "utf8");
    const history = await readJson(historyPath, { records: [] });
    const record = {
      date: files[key].dataDate,
      generatedAt: files[key].generatedAt,
      count: files[key].count,
      candidates: files[key].candidates
    };
    const merged = mergeHistory(history, record);
    await writeFile(historyPath, JSON.stringify(merged, null, 2), "utf8");
    results.push({ key, latest: latestPath.pathname, history: historyPath.pathname, count: files[key].count });
  }
  return results;
}

// CLI entry point.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
  const marketData = JSON.parse(await readFile(new URL("../data/market-risk.json", import.meta.url), "utf8"));
  const results = await saveSharedCandidates(marketData);
  for (const result of results) {
    console.log(`Saved ${result.count} ${result.key} candidates to ${result.latest} and ${result.history}.`);
  }
}
