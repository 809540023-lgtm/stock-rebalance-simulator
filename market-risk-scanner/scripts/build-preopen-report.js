// Builds a small 07:00 Taipei pre-open report from the latest shared model
// snapshots. This is a publishable research report, not an order list.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_PREOPEN_CONFIG, PREOPEN_VERSION } from "./preopen-research.js";

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);
const REPORT_PATH = new URL("preopen-report.json", SHARED_DIR);
const HISTORY_PATH = new URL("preopen-history.json", SHARED_DIR);

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(snapshot, side, limit) {
  const rows = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
  return rows
    .filter((row) => row.tradingEligible !== false)
    .filter((row) => /^\d{4}$/.test(String(row.code)) && !String(row.name || "").includes("-DR"))
    .filter((row) => {
      const predicted = parseNumber(row.predictedChangePct);
      if (predicted == null) return true;
      return side === "long" ? predicted >= 0 : predicted <= 0;
    })
    .map((row) => ({
      side,
      code: String(row.code),
      name: row.name || "",
      market: row.market || "",
      close: parseNumber(row.endPrice),
      score: parseNumber(row.score) ?? 0,
      predictedChangePct: parseNumber(row.predictedChangePct),
      reasons: Array.isArray(row.reasons) ? row.reasons.slice(0, 6) : [],
      action: side === "long" ? "watch-buy" : "watch-short",
      caution: side === "short"
        ? "需另外確認券商庫存、可先賣後買、借券或融券限制。"
        : "需等開盤後成交價與停損停利條件確認。"
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

export function buildPreopenReport({ bullish, bearish, now = new Date(), config = DEFAULT_PREOPEN_CONFIG }) {
  const bullishDate = bullish?.dataDate || null;
  const bearishDate = bearish?.dataDate || null;
  const dataDate = bullishDate && bearishDate && bullishDate === bearishDate ? bullishDate : (bullishDate || bearishDate);
  const warnings = [];
  if (bullish?.stale) warnings.push(bullish.staleWarning || "多頭資料可能過期");
  if (bearish?.stale) warnings.push(bearish.staleWarning || "空頭資料可能過期");
  if (bullishDate && bearishDate && bullishDate !== bearishDate) warnings.push("多空候選資料日期不一致");
  warnings.push("此報告是研究候選清單，不是保證獲利，也不是自動下單。");

  return {
    version: PREOPEN_VERSION,
    generatedAt: now.toISOString(),
    timezone: "Asia/Taipei",
    intendedRunTime: "07:00",
    dataDate,
    sourceFiles: ["data/shared/bullish-latest.json", "data/shared/bearish-latest.json"],
    modelStatus: "legacy-snapshot-plus-preopen-report",
    nextUpgrade: "保存 61 日以上 OHLC 歷史後，改用 preopen-research.js 的完整特徵引擎直接排名。",
    config: {
      longLimit: config.maxLongCandidates,
      shortLimit: config.maxShortCandidates,
      maxPrice: config.maxPrice,
      minAvgVolume20: config.minAvgVolume20,
      minAvgTurnover20: config.minAvgTurnover20
    },
    warnings,
    longCandidates: pick(bullish, "long", config.maxLongCandidates),
    shortCandidates: pick(bearish, "short", config.maxShortCandidates)
  };
}

function mergeHistory(existing, report) {
  const records = Array.isArray(existing?.records) ? existing.records : [];
  const key = report.dataDate || report.generatedAt.slice(0, 10);
  if (!records.some((record) => record.date === key)) {
    records.push({
      date: key,
      generatedAt: report.generatedAt,
      longCount: report.longCandidates.length,
      shortCount: report.shortCandidates.length,
      longCandidates: report.longCandidates,
      shortCandidates: report.shortCandidates,
      warnings: report.warnings
    });
  }
  return { records };
}

export async function savePreopenReport() {
  const [bullish, bearish, history] = await Promise.all([
    readJson(new URL("bullish-latest.json", SHARED_DIR)),
    readJson(new URL("bearish-latest.json", SHARED_DIR)),
    readJson(HISTORY_PATH, { records: [] })
  ]);
  if (!bullish && !bearish) throw new Error("No shared candidate snapshots found.");
  const report = buildPreopenReport({ bullish, bearish });
  await mkdir(SHARED_DIR, { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  await writeFile(HISTORY_PATH, JSON.stringify(mergeHistory(history, report), null, 2), "utf8");
  return report;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
  const report = await savePreopenReport();
  console.log(`Saved pre-open report for ${report.dataDate || "unknown date"}: ${report.longCandidates.length} long, ${report.shortCandidates.length} short.`);
}
