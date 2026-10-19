import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readImportFile } from "./read";
import { detectFormat, formatMismatch, getParser, isBetaFormat } from "./registry";
import { buildPreview, type ImportSettings } from "./normalize";
import { parseNumber } from "./util";
import { calculateJournalAnalytics } from "../stats";
import { groupTradesByDay } from "../overview";
import type { Account, Trade } from "../types";
import type { RawTable } from "./types";

// "TradeTrack (CSV)" preset on the owner's real export (29 rows).
const FIX = path.join(__dirname, "__fixtures__");
const ACC: Account = { id: "acc", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" };
const settings = (over: Partial<ImportSettings> = {}): ImportSettings => ({
  formatId: "tradetrack",
  accountId: "acc",
  batchId: "b1",
  rMode: "none",
  nowIso: "2026-10-19T00:00:00.000Z",
  ...over,
});

async function readTables(file: string): Promise<RawTable[]> {
  const res = await readImportFile(file, new Uint8Array(fs.readFileSync(path.join(FIX, file))), 10 * 1024 * 1024);
  expect(res.error).toBeUndefined();
  return res.tables;
}

async function presetImport(existing: Trade[] = [], over: Partial<ImportSettings> = {}) {
  const tables = await readTables("tradetrack.csv");
  const det = detectFormat(tables)!;
  return buildPreview(det.parser.parse(det.table, { timeZone: "UTC" }).trades, existing, settings(over));
}

const csvPnlSum = (() => {
  const lines = fs.readFileSync(path.join(FIX, "tradetrack.csv"), "utf8").trim().split(/\r?\n/).slice(1);
  return lines.reduce((s, l) => s + (parseNumber(l.split('","')[6]) ?? 0), 0);
})();

describe("TradeTrack (CSV) preset", () => {
  it("is detected automatically by its header and is not beta (checked on a real file)", async () => {
    const det = detectFormat(await readTables("tradetrack.csv"))!;
    expect(det.parser.id).toBe("tradetrack");
    expect(isBetaFormat("tradetrack")).toBe(false);
  });

  it("other files are not taken for TradeTrack", async () => {
    for (const file of ["universal.csv", "matchtrader.csv", "mt5-deals.csv", "tradingview.csv"]) {
      expect(detectFormat(await readTables(file))!.parser.id, file).not.toBe("tradetrack");
    }
  });

  it("29 trades: 28 closed + 1 open, 0 duplicates, 0 errors; all columns mapped by the preset", async () => {
    const tables = await readTables("tradetrack.csv");
    const parsed = getParser("tradetrack").parse(tables[0], { timeZone: "UTC" });
    expect(parsed.errors).toEqual([]);
    const preview = buildPreview(parsed.trades, [], settings());
    expect(preview).toHaveLength(29);
    expect(preview.filter((r) => r.status !== "new")).toEqual([]);
    expect(preview.filter((r) => r.trade.status === "closed")).toHaveLength(28);
    expect(preview.filter((r) => r.open)).toHaveLength(1);
    const t = preview.find((r) => r.trade.pnlMoney === -74.43)!.trade;
    // PnL is final: commission stored separately, not subtracted again
    expect(t).toMatchObject({ fees: 0.5, rMultiple: -0.05, riskPercent: 3, outcome: "sl", session: "london", result: "loss", source: "import", verification: "imported" });
    expect(preview.find((r) => r.trade.pnlMoney === 247.45)!.trade.closedAt!.slice(0, 10)).toBe("2026-10-14");
  });

  it("re-import: 0 new, 29 duplicates — also against trades imported earlier with the universal CSV mapping", async () => {
    const first = (await presetImport()).map((r) => r.trade);
    const again = await presetImport(first, { batchId: "b2" });
    expect(again.filter((r) => r.status === "new")).toHaveLength(0);
    expect(again.filter((r) => r.status === "duplicate")).toHaveLength(29);
    const viaUniversal = first.map((tr) => ({ ...tr, importBatchId: "old", id: `${tr.id}_u` }));
    expect((await presetImport(viaUniversal, { batchId: "b3" })).filter((r) => r.status === "new")).toHaveLength(0);
  });

  it("analytics: Winrate and Profit Factor calculated, R known 28 of 28, total = sum of the file's PnL, day totals", async () => {
    const trades = (await presetImport()).map((r) => r.trade);
    const a = calculateJournalAnalytics(trades, [ACC]);
    expect(a.totalTrades).toBe(28);
    expect(a.winRate).toBeCloseTo(13 / 28, 6);
    expect(a.winRate).toBeGreaterThan(0);
    expect(a.profitFactorMoney).not.toBeNull();
    expect(a.profitFactorR).not.toBeNull();
    expect(a.knownRCount).toBe(28);
    const total = trades.reduce((s, t) => s + (t.pnlMoney ?? 0), 0);
    expect(Math.round(total * 100) / 100).toBe(Math.round(csvPnlSum * 100) / 100);
    expect(Math.round(total * 100) / 100).toBe(10.54);
    const oct13 = groupTradesByDay(trades.filter((t) => t.status === "closed"), "UTC").find((g) => g.dateKey === "2026-10-13")!;
    expect(oct13.trades).toHaveLength(5);
    expect(Math.round(oct13.netMoney! * 100) / 100).toBe(-491.16);
  });

  it("strategies from the file come through for matching or creation", async () => {
    const names = new Set((await presetImport()).map((r) => r.source.strategyName).filter(Boolean));
    expect([...names].sort()).toEqual(["HTF FVG + CISD", "MALKIS Trades Model", "ORDER BLOCK + MSS"]);
  });
});

describe("a platform picked by hand that does not fit the file explains why", () => {
  it("Match-Trader on the TradeTrack file: names the missing columns instead of silently finding 0 trades", async () => {
    const [table] = await readTables("tradetrack.csv");
    expect(getParser("matchtrader").parse(table, { timeZone: "UTC" }).trades).toHaveLength(0);
    expect(formatMismatch(getParser("matchtrader"), table)).toEqual({
      missing: ["Symbol", "Side", "Open Time", "Open Price", "Close Time", "Close Price", "Profit"],
    });
  });

  it("no explanation when the file fits, or for the universal mapping", async () => {
    const [tt] = await readTables("tradetrack.csv");
    const [mt] = await readTables("matchtrader.csv");
    expect(formatMismatch(getParser("tradetrack"), tt)).toBeNull();
    expect(formatMismatch(getParser("matchtrader"), mt)).toBeNull();
    expect(formatMismatch(getParser("universal"), tt)).toBeNull();
    expect(formatMismatch(getParser("tradetrack"), mt)).toEqual({ missing: expect.arrayContaining(["Дата входа", "RR"]) });
  });
});
