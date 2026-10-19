import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./read";
import { getParser } from "./registry";
import { buildPreview, contentKey, strategyNameKey, type ImportSettings } from "./normalize";
import { completeMapping, mappedColumnHasNoNumbers, suggestMapping } from "./parsers/universal";
import { parseNumber, parseOutcome, parseSession } from "./util";
import { calculateJournalAnalytics } from "../stats";
import { groupTradesByDay } from "../overview";
import type { Account, Trade } from "../types";

// Real TradeTrack export (29 rows, owner's file 2026-10-19): dates without time, PnL, RR, outcome, session, strategy.
const FILE = fs.readFileSync(path.join(__dirname, "__fixtures__/tradetrack.csv"), "utf8");
const rows = parseCsv(FILE);
const header = rows[0];
const col = (name: string) => header.indexOf(name);
const ACC: Account = { id: "acc", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" };
const settings = (over: Partial<ImportSettings> = {}): ImportSettings => ({
  formatId: "universal",
  accountId: "acc",
  batchId: "b1",
  rMode: "none",
  nowIso: "2026-10-19T00:00:00.000Z",
  ...over,
});
const parse = () => getParser("universal").parse({ kind: "csv", rows }, { timeZone: "UTC" });
const importOnce = (existing: Trade[] = [], over: Partial<ImportSettings> = {}) => buildPreview(parse().trades, existing, settings(over));
const filePnlSum = rows.slice(1).reduce((s, r) => s + (parseNumber(r[col("PnL")]) ?? 0), 0);

describe("universal CSV: columns are recognised by name (RU/EN)", () => {
  it("every TradeTrack column lands in its field; exit date is not left unused", () => {
    const m = suggestMapping(header, rows.slice(1));
    const named = Object.fromEntries(Object.entries(m).map(([f, i]) => [f, header[i!]]));
    expect(named).toEqual({
      instrument: "Символ",
      direction: "Направление",
      openedAt: "Дата входа",
      closedAt: "Дата выхода",
      size: "Объём",
      pnl: "PnL",
      commission: "Комиссии",
      rMultiple: "RR",
      riskPercent: "Риск (%)",
      outcome: "Результат",
      session: "Сессия",
      strategy: "Стратегия",
    });
  });

  it("English headers too; a percentage column is never taken for money", () => {
    const m = suggestMapping(["Entry Date", "Exit Date", "Symbol", "Side", "Profit %", "Net PnL", "Fees", "R Multiple", "Outcome", "Session", "Setup"]);
    expect(m).toMatchObject({ openedAt: 0, closedAt: 1, instrument: 2, direction: 3, pnl: 5, commission: 6, rMultiple: 7, outcome: 8, session: 9, strategy: 10 });
  });

  it("a mapping remembered before these fields existed is completed; an explicit 'not used' (-1) is kept", () => {
    const old = { instrument: col("Символ"), direction: col("Направление"), openedAt: col("Дата входа"), size: col("Объём"), pnl: col("PnL") };
    const done = completeMapping(old, header, rows.slice(1));
    expect(done).toMatchObject({ ...old, closedAt: col("Дата выхода"), rMultiple: col("RR"), outcome: col("Результат"), strategy: col("Стратегия") });
    expect(completeMapping({ ...old, closedAt: -1 }, header).closedAt).toBe(-1);
  });

  it("warns when an amount field is mapped to a column without numbers (P&L -> the TP/SL column)", () => {
    expect(mappedColumnHasNoNumbers("pnl", rows.slice(1), col("Результат"))).toBe(true);
    expect(mappedColumnHasNoNumbers("pnl", rows.slice(1), col("PnL"))).toBe(false);
    expect(mappedColumnHasNoNumbers("outcome", rows.slice(1), col("Результат"))).toBe(false);
  });

  it("outcome and session names", () => {
    expect(["TP", "SL", "BE", "Take Profit", "Стоп", ""].map(parseOutcome)).toEqual(["tp", "sl", "be", "tp", "sl", undefined]);
    expect(["New York Session", "London Session", "Asian Session", "Overlap London/New York", "Лондон", "", "Weekend"].map(parseSession)).toEqual([
      "newyork",
      "london",
      "asia",
      "overlap",
      "london",
      undefined,
      "other",
    ]);
  });
});

describe("TradeTrack file (29 rows) through the universal CSV import", () => {
  it("29 trades: 28 closed and 1 open, no duplicates, no errors", () => {
    const parsed = parse();
    expect(parsed.errors).toEqual([]);
    const preview = importOnce();
    expect(preview).toHaveLength(29);
    expect(preview.filter((r) => r.status !== "new")).toEqual([]);
    expect(preview.filter((r) => r.trade.status === "closed")).toHaveLength(28);
    const open = preview.filter((r) => r.open);
    expect(open).toHaveLength(1);
    // 12 October: no PnL and no outcome -> open, not an error, not a duplicate
    expect(open[0].trade).toMatchObject({ instrument: "UKOIL", status: "open", closedAt: undefined, pnlMoney: undefined });
    expect(open[0].trade.openedAt.slice(0, 10)).toBe("2026-10-12");
  });

  it("re-importing the same file: 0 new, 29 duplicates, each with its reason", () => {
    const first = importOnce().map((r) => r.trade);
    const again = importOnce(first, { batchId: "b2" });
    expect(again.filter((r) => r.status === "new")).toEqual([]);
    expect(again.map((r) => r.reason)).toEqual(Array(29).fill("content"));
  });

  it("duplicates are counted: two identical journal trades cover two identical rows, one covers one", () => {
    const row = ["10/13/26", "10/13/26", "Match Trader", "UKOIL", "BUY", "1", "400.02", "USD", "", "0.80", "1.00", "0.80", "TP", "", ""];
    const two = getParser("universal").parse({ kind: "csv", rows: [header, row, row] }, { timeZone: "UTC" }).trades;
    const firstImport = buildPreview(two, [], settings()).map((r) => r.trade);
    expect(firstImport).toHaveLength(2);
    expect(buildPreview(two, firstImport, settings({ batchId: "b2" })).map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(buildPreview(two, firstImport.slice(0, 1), settings({ batchId: "b2" })).map((r) => r.status)).toEqual(["duplicate", "new"]);
  });

  it("different trades with a different PnL are never duplicates, even on the same day and instrument", () => {
    const keys = importOnce()
      .filter((r) => r.trade.instrument === "UKOIL" && r.trade.openedAt.startsWith("2026-10-13"))
      .map((r) => contentKey(r.trade));
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(5);
  });

  it("fields: R from RR, risk %, outcome, session, commission kept separately (PnL is final)", () => {
    const byPnl = (pnl: number) => importOnce().find((r) => r.trade.pnlMoney === pnl)!.trade;
    expect(byPnl(1002.58)).toMatchObject({ rMultiple: 2.01, riskPercent: 1, outcome: "tp", session: "newyork", result: "win", status: "closed" });
    expect(byPnl(-74.43)).toMatchObject({ rMultiple: -0.05, riskPercent: 3, fees: 0.5, outcome: "sl", session: "london", result: "loss" });
    expect(byPnl(472.32).session).toBe("overlap");
    expect(byPnl(720.8)).toMatchObject({ session: "asia" });
    expect(byPnl(-312).session).toBeUndefined();
  });

  it("order within a day follows the file (newest on top); a later exit date is used", () => {
    const day = importOnce()
      .map((r) => r.trade)
      .filter((t) => t.openedAt.startsWith("2026-10-13"))
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    // bottom row of the 13th happened first
    expect(day.map((t) => t.pnlMoney)).toEqual([-482.25, -263.4, -392.98, 400.02, 247.45]);
    const late = day.find((t) => t.pnlMoney === 247.45)!;
    expect(late.closedAt!.slice(0, 10)).toBe("2026-10-14");
    expect(Date.parse(late.closedAt!)).toBeGreaterThanOrEqual(Date.parse(late.openedAt));
  });

  it("analytics: Winrate and Profit Factor are calculated (not 0 / empty), total equals the file's PnL sum, R known 28 of 28", () => {
    const trades = importOnce().map((r) => r.trade);
    const a = calculateJournalAnalytics(trades, [ACC]);
    expect(a.totalTrades).toBe(28);
    const wins = trades.filter((t) => t.result === "win").length;
    expect(wins).toBe(13);
    expect(a.winRate).toBeCloseTo(13 / 28, 6);
    expect(a.winRate).toBeGreaterThan(0);
    expect(a.profitFactorMoney).not.toBeNull();
    expect(a.profitFactorR).not.toBeNull();
    expect(a.knownRCount).toBe(28);
    const total = trades.reduce((s, t) => s + (t.pnlMoney ?? 0), 0);
    expect(Math.round(total * 100) / 100).toBe(Math.round(filePnlSum * 100) / 100);
    expect(Math.round(filePnlSum * 100) / 100).toBe(10.54);
  });

  it("without the RR column money metrics still work and 'R known' tells the truth", () => {
    const noRR = rows.map((r) => r.filter((_, i) => i !== col("RR")));
    const trades = buildPreview(getParser("universal").parse({ kind: "csv", rows: noRR }, { timeZone: "UTC" }).trades, [], settings()).map((r) => r.trade);
    const a = calculateJournalAnalytics(trades, [ACC]);
    expect(a.knownRCount).toBe(0);
    expect(a.winRate).toBeCloseTo(13 / 28, 6);
    expect(a.profitFactorMoney).not.toBeNull();
  });

  it("day totals are computed for every day", () => {
    const trades = importOnce().map((r) => r.trade);
    const days = groupTradesByDay(trades.filter((t) => t.status === "closed"), "UTC");
    const oct13 = days.find((g) => g.dateKey === "2026-10-13")!;
    expect(oct13.trades).toHaveLength(5);
    expect(Math.round(oct13.netMoney! * 100) / 100).toBe(Math.round((247.45 + 400.02 - 392.98 - 263.4 - 482.25) * 100) / 100);
    expect(oct13.netR).toBeCloseTo(0.49 + 0.8 - 0.79 - 0.53 - 0.96, 6);
  });

  it("strategies from the file are matched by name or attached to the ids the user agreed to create", () => {
    const names = [...new Set(parse().trades.map((t) => t.strategyName).filter(Boolean))];
    expect(names.sort()).toEqual(["HTF FVG + CISD", "MALKIS Trades Model", "ORDER BLOCK + MSS"]);
    const ids = { [strategyNameKey("htf fvg + cisd")]: "str_existing", [strategyNameKey("MALKIS Trades Model")]: "str_new" };
    const trades = importOnce([], { strategyIds: ids }).map((r) => r.trade);
    expect(trades.filter((t) => t.strategyId === "str_existing")).toHaveLength(8);
    expect(trades.filter((t) => t.strategyId === "str_new")).toHaveLength(3);
    // not matched and not created -> no strategy
    expect(trades.find((t) => t.pnlMoney === 383.92)!.strategyId).toBeNull();
  });

  it("imported trades are marked as imports (they never give XP)", () => {
    for (const t of importOnce().map((r) => r.trade)) expect(t).toMatchObject({ source: "import", verification: "imported" });
  });
});
