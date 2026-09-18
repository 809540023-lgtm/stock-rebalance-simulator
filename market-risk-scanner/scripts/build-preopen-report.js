// Builds a small 07:00 Taipei pre-open report from the latest shared model
// snapshots. This is a publishable research report, not an order list.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_PREOPEN_CONFIG, PREOPEN_VERSION, rankPreopenCandidates } from "./preopen-research.js";

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

function engineStocksFromHistory(history) {
  const stocks = [];
  for (const [key, bars] of Object.entries(history?.stocks || {})) {
    if (!Array.isArray(bars) || !bars.length) continue;
    const [code, market] = key.split("|");
    const name = (history.names && history.names[key]) || "";
    // Exclude DR (depository receipt) listings, matching the legacy report filter.
    if (String(name).includes("-DR")) continue;
    stocks.push({
      code,
      market,
      name: (history.names && history.names[key]) || "",
      bars,
      // Optimistic trading gates: broker/disposition specifics still rely on
      // the existing snapshots; the strict OHLCV engine enforces price, volume,
      // turnover and return gates itself.
      adjustmentVerified: true,
      commonStock: true,
      dayTradeAllowed: true,
      sellFirstAllowed: true,
      marginShortAllowed: true,
      disposition: false,
      suspended: false,
      alteredTrading: false
    });
  }
  return stocks;
}

function strictCandidateRow(c) {
  return {
    rank: c.rank,
    side: c.side,
    code: c.code,
    name: c.name || "",
    market: c.market || "",
    close: c.close,
    score: c.score,
    predictedChangePct: c.predictedChangePct ?? null,
    reasons: c.reasons || [],
    action: c.side === "long" ? "watch-buy" : "watch-short",
    caution: c.side === "short"
      ? "需另外確認券商庫存、可先賣後買、借券或融券限制（本報告沿用既有快照資格門檻，未含即時庫存）。"
      : "需等開盤後成交價與停損停利條件確認。"
  };
}

// Label whether each short candidate is confirmed shortable at the official
// (TWSE MI_MARGN) level before calling it tradable. A specific broker's live
// inventory is still a separate, per-broker confirmation.
function annotateShortAvailability(rows, ohlcv) {
  const availability = ohlcv?.shortAvailability?.byCode || {};
  const date = ohlcv?.shortAvailability?.date || null;
  const out = [];
  const unconfirmed = [];
  for (const c of rows) {
    const info = availability[String(c.code)];
    const confirmed = Boolean(date && info && info.allowed);
    const row = strictCandidateRow(c);
    row.shortTradable = confirmed;
    row.shortEligibilityDate = date;
    row.shortNextDayLimit = info ? info.nextDayLimit : null;
    row.shortNote = info && info.note ? info.note : null;
    if (!confirmed) unconfirmed.push(String(c.code));
    out.push(row);
  }
  return { rows: out, unconfirmed, date };
}

// Prefer the strict 61-bar pre-open engine when candidate OHLCV history and
// the index are aligned through the report data date; otherwise fall back to
// the legacy snapshot ranking.
export function buildStrictPreopenReport({ bullish, bearish, ohlcv, now = new Date(), config = DEFAULT_PREOPEN_CONFIG }) {
  const bullishDate = bullish?.dataDate || null;
  const bearishDate = bearish?.dataDate || null;
  const dataDate = bullishDate && bearishDate && bullishDate === bearishDate ? bullishDate : (bullishDate || bearishDate);
  const warnings = ["此報告是研究候選清單，不是保證獲利，也不是自動下單。"];
  if (bullish?.stale) warnings.push(bullish.staleWarning || "多頭資料可能過期");
  if (bearish?.stale) warnings.push(bearish.staleWarning || "空頭資料可能過期");
  if (bullishDate && bearishDate && bullishDate !== bearishDate) warnings.push("多空候選資料日期不一致");

  const stockKeys = Object.keys(ohlcv?.stocks || {});
  const strictUsable = Boolean(dataDate && (ohlcv?.index?.length || 0) > 0 && stockKeys.length > 0);
  let longCandidates = [];
  let shortCandidates = [];
  let modelStatus = "preopen-research-engine-full";
  let nextUpgrade = "";
  let engineDetail = "";
  let sourceFiles = ["data/shared/ohlcv-history.json"];
  let shortEligibilityDate = null;
  let unconfirmedShortCodes = [];

  if (strictUsable) {
    try {
      const ranked = rankPreopenCandidates(engineStocksFromHistory(ohlcv), ohlcv.index, dataDate, config);
      if (ranked.long.length || ranked.short.length) {
        longCandidates = ranked.long.map(strictCandidateRow);
        const annotated = annotateShortAvailability(ranked.short, ohlcv);
        shortCandidates = annotated.rows;
        shortEligibilityDate = annotated.date;
        if (annotated.unconfirmed.length) {
          unconfirmedShortCodes = annotated.unconfirmed;
          warnings.push(`放空候選${annotated.unconfirmed.length} 檔尚未確認融券可放空：${annotated.unconfirmed.slice(0, 8).join("、")}${annotated.unconfirmed.length > 8 ? "、…" : ""}（依證交所 MI_MARGN）`);
        }
        engineDetail = `以 ${stockKeys.length} 檔候選的 ${(ohlcv.stocks[stockKeys[0]] || []).length} 日 OHLCV 歷史（asOf ${ohlcv.meta?.asOfDate || dataDate}）直接用嚴格特徵引擎排名${annotated.date ? `；融券可放空確認資料日 ${annotated.date}` : "；無融券可放空確認資料"}`;
      }
    } catch {
      // fall through to legacy
    }
  }

  if (!longCandidates.length && !shortCandidates.length) {
    longCandidates = pick(bullish, "long", config.maxLongCandidates);
    shortCandidates = pick(bearish, "short", config.maxShortCandidates);
    modelStatus = "legacy-snapshot-plus-preopen-report";
    sourceFiles = ["data/shared/bullish-latest.json", "data/shared/bearish-latest.json"];
    nextUpgrade = strictUsable
      ? "候選 OHLCV 歷史或指數未對齊資料日；累積 61 日以上完整 OHLCV 後即可全用嚴格引擎。"
      : "保存 61 日以上 OHLC 歷史後，改用 preopen-research.js 的完整特徵引擎直接排名。";
  }

  return {
    version: PREOPEN_VERSION,
    generatedAt: now.toISOString(),
    timezone: "Asia/Taipei",
    intendedRunTime: "07:00",
    dataDate,
    sourceFiles,
    modelStatus,
    nextUpgrade,
    engineDetail,
    config: {
      longLimit: config.maxLongCandidates,
      shortLimit: config.maxShortCandidates,
      maxPrice: config.maxPrice,
      minAvgVolume20: config.minAvgVolume20,
      minAvgTurnover20: config.minAvgTurnover20
    },
    engineDetail,
    config: {
      longLimit: config.maxLongCandidates,
      shortLimit: config.maxShortCandidates,
      maxPrice: config.maxPrice,
      minAvgVolume20: config.minAvgVolume20,
      minAvgTurnover20: config.minAvgTurnover20
    },
    warnings,
    longCandidates,
    shortCandidates,
    shortEligibilityDate,
    unconfirmedShortCodes
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
  const [bullish, bearish, history, ohlcv] = await Promise.all([
    readJson(new URL("bullish-latest.json", SHARED_DIR)),
    readJson(new URL("bearish-latest.json", SHARED_DIR)),
    readJson(HISTORY_PATH, { records: [] }),
    readJson(new URL("ohlcv-history.json", SHARED_DIR), null)
  ]);
  if (!bullish && !bearish) throw new Error("No shared candidate snapshots found.");
  const report = buildStrictPreopenReport({ bullish, bearish, ohlcv });
  await mkdir(SHARED_DIR, { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  await writeFile(HISTORY_PATH, JSON.stringify(mergeHistory(history, report), null, 2), "utf8");
  return report;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
  const report = await savePreopenReport();
  console.log(`Saved pre-open report for ${report.dataDate || "unknown date"}: ${report.longCandidates.length} long, ${report.shortCandidates.length} short (${report.modelStatus}).`);
}
