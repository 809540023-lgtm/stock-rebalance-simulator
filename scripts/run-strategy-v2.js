import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildV2Report, calendarSessions, taipeiDate, V2_VERSION, V2_EFFECTIVE_DATE } from "../market-risk-scanner/scripts/strategy-v2.js";
import { rocDateToIso } from "../market-risk-scanner/scripts/persist-ohlcv-history.js";
import { refreshV2History } from "./strategy-v2-data.js";

const ROOT = new URL("../", import.meta.url);
export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}
export async function atomicJson(path, value) {
  await mkdir(new URL(".", path), { recursive: true });
  const temp = new URL(`${path.href}.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}
export async function freezeReport(path, report) {
  if (report.status !== "ready" || report.preview || Date.parse(report.generatedAt) >= Date.parse(report.cutoff)) throw new Error("Only an on-time formal report can be frozen");
  await mkdir(new URL(".", path), { recursive: true });
  try { await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); return report; }
  catch (e) { if (e.code !== "EEXIST") throw e; return readJson(path); }
}
async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${new URL(url).pathname}: HTTP ${r.status}`);
  return r.json();
}
export function unavailableReport(config, tradeDate, now, status, detail) {
  return { version: V2_VERSION, effectiveDate: V2_EFFECTIVE_DATE, tradeDate, dataDate: null, generatedAt: now.toISOString(), cutoff: `${tradeDate}T${config.cutoff}+08:00`, modelStatus: "strategy-v2", status, config, warnings: [detail], longCandidates: [], shortCandidates: [], contrarianWatchlist: [], executionMode: "research-only" };
}

export async function runV2({ tradeDate = taipeiDate(), preview = false, refresh = true, publish = false, now = new Date() } = {}) {
  const config = await readJson(new URL("data/shared/strategy-v2-config.json", ROOT));
  const latestPath = new URL(`data/shared/strategy-v2-${preview ? "preview" : "latest"}.json`, ROOT);
  const archivePath = new URL(`data/shared/strategy-v2-reports/${tradeDate}.json`, ROOT);
  if (tradeDate < config.effectiveDate) throw new Error("V2 is not effective before 2026-11-12");
  const frozen = !preview && await readJson(archivePath);
  if (frozen) { await atomicJson(latestPath, frozen); return frozen; }
  const prepared = !preview && await readJson(latestPath);
  if (publish && prepared?.version === V2_VERSION && prepared.tradeDate === tradeDate && prepared.status === "market-closed") return prepared;
  if (publish || now.getTime() >= Date.parse(`${tradeDate}T${config.cutoff}+08:00`)) {
    const blocked = unavailableReport(config, tradeDate, now, "missed-cutoff", "07:00 前沒有完成固定名單；今天不補做盤前選股、不使用舊名單。");
    await atomicJson(latestPath, blocked); return blocked;
  }
  let report;
  try {
    const calendar = await fetchJson("https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule");
    const sessions = calendarSessions(calendar, Number(tradeDate.slice(0, 4)));
    const asOfDate = sessions.filter((d) => d < tradeDate).at(-1);
    if (!sessions.includes(tradeDate)) {
      report = unavailableReport(config, tradeDate, now, "market-closed", "依證交所年曆休市；不產生模擬交易。");
      await atomicJson(latestPath, report); return report;
    }
    let ohlcv = await readJson(new URL("data/shared/ohlcv-history.json", ROOT), { stocks: {}, index: [], names: {} });
    if (refresh) {
      ohlcv = await refreshV2History(ohlcv, asOfDate, config);
      // Do not truncate later observations when explicitly previewing an old date.
      const previous = await readJson(new URL("data/shared/ohlcv-history.json", ROOT));
      if (!previous?.meta?.asOfDate || previous.meta.asOfDate <= asOfDate) await atomicJson(new URL("data/shared/ohlcv-history.json", ROOT), ohlcv);
    }
    const verification = process.env.STRATEGY_VERIFICATION_FILE ? await readJson(pathToFileURL(process.env.STRATEGY_VERIFICATION_FILE), {}) : {};
    const providerWarnings = [];
    try {
      const punish = await fetchJson("https://openapi.twse.com.tw/v1/announcement/punish");
      if (!Array.isArray(punish)) throw new Error("Invalid disposition response");
      for (const row of punish) {
        const dates = String(row.DispositionPeriod || "").match(/\d{3}\/\d{2}\/\d{2}/g);
        // Ambiguous restriction periods stay blocked rather than being ignored.
        if (!dates || (rocDateToIso(dates[0]) <= tradeDate && rocDateToIso(dates.at(-1)) >= tradeDate)) {
          const key = `${row.Code}|上市`;
          verification[key] = { ...verification[key], disposition: true };
        }
      }
    } catch (e) {
      providerWarnings.push(`處置名單未取得：${e.message}`);
      for (const key of Object.keys(verification)) verification[key] = { ...verification[key], disposition: null };
    }
    report = buildV2Report({ ohlcv, calendar, config, tradeDate, verification, preview, now: new Date(Math.max(now.getTime(), Date.now())) });
    report.warnings.push(...providerWarnings);
    const { reportId: ignored, ...content } = report;
    report.reportId = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    if (!preview && report.status === "ready") report = await freezeReport(archivePath, report);
  } catch (e) {
    report = unavailableReport(config, tradeDate, new Date(), "data-blocked", `資料驗證失敗：${e.message}；不回退舊策略。`);
  }
  await atomicJson(latestPath, report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const date = args.find((a) => a.startsWith("--trade-date="))?.split("=")[1];
  const r = await runV2({ ...(date ? { tradeDate: date } : {}), preview: args.includes("--preview"), refresh: !args.includes("--no-refresh"), publish: args.includes("--publish") });
  console.log(JSON.stringify({ version: r.version, tradeDate: r.tradeDate, status: r.status, long: r.longCandidates.length, short: r.shortCandidates.length, excluded: r.rejected?.length, warnings: r.warnings }));
}
