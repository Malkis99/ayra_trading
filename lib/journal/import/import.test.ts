import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readImportFile, parseCsv, readZip } from "./read";
import { detectFormat, getParser } from "./registry";
import { buildPreview, buildTrade, netPnl, type ImportSettings } from "./normalize";
import { pairFills } from "./pipelines";
import { parseDateTime, parseNumber, parseSide } from "./util";
import { suggestMapping } from "./parsers/universal";
import type { ImportFormatId, NormalizedTrade, ParseResult } from "./types";
import type { Trade } from "../types";
import { tableToCsv, tableToXlsx, tradesToJson, tradesToTable, guardCell, exportFileName } from "../export";

const FIX = path.join(__dirname, "__fixtures__");
const MAX = 10 * 1024 * 1024;

async function load(file: string, expected: ImportFormatId, tz = "UTC"): Promise<ParseResult> {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, file)));
  const { tables, error } = await readImportFile(file, bytes, MAX);
  expect(error).toBeUndefined();
  const det = detectFormat(tables)!;
  expect(det.parser.id, file).toBe(expected);
  return det.parser.parse(det.table, { timeZone: tz });
}

const one = (r: ParseResult) => {
  expect(r.trades).toHaveLength(1);
  return r.trades[0];
};

describe("import utils", () => {
  it("parses numbers in different locales", () => {
    expect(parseNumber("1 234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("($12.50)")).toBe(-12.5);
    expect(parseNumber("$(10.00)")).toBe(-10);
    expect(parseNumber("0.01BTC")).toBe(0.01);
    expect(parseNumber("-7.00")).toBe(-7);
    expect(parseNumber("1,08500")).toBe(1.085);
    expect(parseNumber("10 000")).toBe(10000);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("@MKT")).toBeUndefined();
  });

  it("parses dates in many formats and time zones", () => {
    const utc = { timeZone: "UTC" };
    expect(parseDateTime("2024.03.04 10:15:00", utc)).toBe("2024-03-04T10:15:00.000Z");
    expect(parseDateTime("3/4/2024 9:31:00 PM", utc)).toBe("2024-03-04T21:31:00.000Z");
    expect(parseDateTime("15.03.2024 10:00", utc)).toBe("2024-03-15T10:00:00.000Z");
    expect(parseDateTime("20240304;153000", utc)).toBe("2024-03-04T15:30:00.000Z");
    expect(parseDateTime("2024-03-04T10:00:00-0500", utc)).toBe("2024-03-04T15:00:00.000Z");
    expect(parseDateTime("03/04/2024 10:00:00 EST", utc)).toBe("2024-03-04T15:00:00.000Z");
    expect(parseDateTime("2024-03-04 10:00:00", { timeZone: "UTC+03:00" })).toBe("2024-03-04T07:00:00.000Z");
    expect(parseDateTime("2024-07-01 12:00:00", { timeZone: "Europe/Moscow" })).toBe("2024-07-01T09:00:00.000Z");
    expect(parseDateTime("2024-07-01 12:00:00", { timeZone: "America/New_York" })).toBe("2024-07-01T16:00:00.000Z");
    expect(parseDateTime("bad-date", utc)).toBeUndefined();
  });

  it("reads sides in many spellings", () => {
    expect(parseSide("BUY").direction).toBe("long");
    expect(parseSide("Sell Short")).toMatchObject({ direction: "short", sign: -1 });
    expect(parseSide("Close Long")).toMatchObject({ direction: "long", effect: "close", sign: -1 });
    expect(parseSide("BuyToCover")).toMatchObject({ sign: 1, effect: "close" });
    expect(parseSide("SELL_TO_CLOSE")).toMatchObject({ sign: -1, effect: "close" });
    expect(parseSide("Покупка").direction).toBe("long");
    expect(parseSide("Market pos.").direction).toBeUndefined();
  });

  it("CSV parser handles quotes, delimiters and BOM", () => {
    expect(parseCsv('﻿a;b\n"x;1";"he said ""hi"""\n')).toEqual([["a", "b"], ["x;1", 'he said "hi"']]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("FIFO pairing handles scaling in, partial exits and reversals", () => {
    const f = (row: number, sign: 1 | -1, qty: number, price: number, min: number) => ({
      row,
      sign,
      qty,
      price,
      instrument: "X",
      time: `2024-03-04T10:${String(min).padStart(2, "0")}:00.000Z`,
    });
    const { trades, errors } = pairFills([f(1, 1, 1, 10, 0), f(2, 1, 1, 12, 1), f(3, -1, 3, 13, 2), f(4, 1, 1, 12, 3)], true);
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ direction: "long", size: 2, entryPrice: 11, exitPrice: 13, profit: 4 });
    expect(trades[1]).toMatchObject({ direction: "short", size: 1, entryPrice: 13, exitPrice: 12, profit: 1 });
    expect(errors).toEqual([]);
  });
});

describe("platform parsers (synthetic files built from the documented columns)", () => {
  it("MetaTrader 4 HTML statement", async () => {
    const r = await load("mt4.html", "mt4");
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({
      externalId: "1001",
      instrument: "EURUSD",
      direction: "long",
      openedAt: "2024-03-04T10:15:00.000Z",
      closedAt: "2024-03-04T14:20:00.000Z",
      entryPrice: 1.085,
      exitPrice: 1.088,
      stopLoss: 1.083,
      takeProfit: 1.089,
      size: 1,
      commission: 7,
      swap: -1.5,
      profit: 300,
    });
    expect(netPnl(r.trades[0])).toBe(291.5);
    expect(r.trades[1]).toMatchObject({ instrument: "XAUUSD", direction: "short", profit: -250 });
  });

  it("MetaTrader 5 report: Positions section", async () => {
    const t = one(await load("mt5-positions.html", "mt5"));
    expect(t).toMatchObject({ externalId: "5001", instrument: "GBPUSD", direction: "long", entryPrice: 1.27, exitPrice: 1.273, stopLoss: 1.268, profit: 60, commission: 1.4 });
    expect(t.closedAt).toBe("2024-03-04T12:00:00.000Z");
  });

  it("MetaTrader 5 report: Deals paired in/out", async () => {
    const t = one(await load("mt5-deals.csv", "mt5"));
    expect(t).toMatchObject({ instrument: "USDJPY", direction: "long", size: 0.5, entryPrice: 150.14, exitPrice: 150.5, profit: 120, commission: 3 });
  });

  it("cTrader: zone from the header, day-first dates, gross and net", async () => {
    const r = await load("ctrader.csv", "ctrader");
    expect(r.detectedTimeZone).toBe("UTC+03:00");
    const t = one(r);
    expect(t).toMatchObject({ externalId: "P-77", direction: "short", size: 10000, profit: 20, commission: 0.6 });
    expect(t.openedAt).toBe("2024-03-14T07:00:00.123Z");
    expect(netPnl(t)).toBe(19.4);
  });

  it("Match-Trader, DXtrade, TradeLocker", async () => {
    expect(netPnl(one(await load("matchtrader.csv", "matchtrader")))).toBe(48);
    expect(netPnl(one(await load("dxtrade.csv", "dxtrade")))).toBe(-41);
    const tl = one(await load("tradelocker.csv", "tradelocker"));
    expect(tl).toMatchObject({ instrument: "XAUUSD", stopLoss: 2095, takeProfit: 2115 });
    expect(netPnl(tl)).toBe(99.3);
  });

  it("TradingView paper trading: filled orders only, no profit for futures", async () => {
    const r = await load("tradingview.csv", "tradingview");
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ instrument: "AAPL", direction: "long", profit: 20 });
    expect(r.trades[1]).toMatchObject({ instrument: "NQ1!", direction: "short", profit: undefined, commission: 5 });
  });

  it("NinjaTrader: trades grid and executions", async () => {
    const r = await load("ninjatrader-trades.csv", "ninjatrader");
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ instrument: "ES06-24", direction: "long", size: 2, profit: 450, commission: 4.2 });
    expect(r.trades[0].openedAt).toBe("2024-03-04T09:31:00.000Z");
    expect(r.trades[1]).toMatchObject({ direction: "short", profit: -100 });
    const ex = one(await load("ninjatrader-executions.csv", "ninjatrader"));
    expect(ex).toMatchObject({ direction: "long", size: 2, entryPrice: 18000, exitPrice: 18010, profit: undefined, commission: 2.48 });
  });

  it("Tradovate performance: direction from buy/sell times", async () => {
    const r = await load("tradovate.csv", "tradovate");
    expect(r.trades[0]).toMatchObject({ direction: "long", entryPrice: 5100, exitPrice: 5102.5, profit: 12.5 });
    expect(r.trades[1]).toMatchObject({ direction: "short", entryPrice: 5104, exitPrice: 5105, profit: -10, size: 2 });
  });

  it("Rithmic, Sierra Chart", async () => {
    const ri = one(await load("rithmic.csv", "rithmic"));
    expect(ri).toMatchObject({ instrument: "CLK4", direction: "long", profit: 200, commission: 4.08 });
    const sc = one(await load("sierrachart.txt", "sierrachart"));
    expect(sc).toMatchObject({ direction: "short", profit: 250, commission: 4.5 });
  });

  it("Interactive Brokers: Flex query and Activity statement", async () => {
    const flex = one(await load("ibkr-flex.csv", "ibkr"));
    expect(flex).toMatchObject({ instrument: "MSFT", direction: "long", profit: 48, commission: 2, openedAt: "2024-03-04T15:30:00.000Z" });
    const act = one(await load("ibkr-activity.csv", "ibkr"));
    expect(act).toMatchObject({ instrument: "TSLA", direction: "long", profit: 48, commission: 2 });
  });

  it("thinkorswim, tastytrade, Webull", async () => {
    expect(one(await load("thinkorswim.csv", "thinkorswim"))).toMatchObject({ instrument: "AMD", direction: "long", profit: 250 });
    const tt = one(await load("tastytrade.csv", "tastytrade"));
    expect(tt).toMatchObject({ instrument: "SPY", direction: "long", profit: 20, openedAt: "2024-03-04T15:00:00.000Z" });
    const wb = one(await load("webull.csv", "webull"));
    expect(wb).toMatchObject({ instrument: "NVDA", direction: "short", profit: 30, openedAt: "2024-03-04T15:00:01.000Z" });
  });

  it("crypto exchanges", async () => {
    const bf = await load("binance-futures.csv", "binance");
    expect(bf.trades).toHaveLength(1);
    expect(bf.trades[0]).toMatchObject({ direction: "long", size: 0.01, entryPrice: 60000, exitPrice: 61400, profit: 11.33 });
    expect(bf.errors).toEqual([{ row: 4, code: "unpairedFill" }]); // the rest of the reversal stays open
    expect(one(await load("binance-spot.csv", "binance"))).toMatchObject({ instrument: "ETHUSDT", size: 0.5, profit: 50 });
    expect(one(await load("bybit-closed.csv", "bybit"))).toMatchObject({ instrument: "SOLUSDT", direction: "short", profit: 49.1 });
    expect(netPnl(one(await load("okx.csv", "okx")))).toBe(19);
    expect(netPnl(one(await load("kucoin.csv", "kucoin")))).toBe(9.79);
    expect(netPnl(one(await load("bitget.csv", "bitget")))).toBe(9.27);
    expect(netPnl(one(await load("mexc.csv", "mexc")))).toBe(29.37);
    expect(one(await load("bingx.csv", "bingx"))).toMatchObject({ direction: "short", profit: 5 });
    expect(netPnl(one(await load("gateio.csv", "gateio")))).toBe(9.87);
    expect(netPnl(one(await load("kraken.csv", "kraken")))).toBe(6.86);
    const cb = one(await load("coinbase.csv", "coinbase"));
    expect(cb).toMatchObject({ instrument: "ETH", direction: "long", size: 0.1, entryPrice: 3500, exitPrice: 3600, profit: 10, commission: 10 });
  });

  it("universal CSV: mapping suggested from headers, row errors with row numbers", async () => {
    const r = await load("universal.csv", "universal");
    const t = one(r);
    expect(t).toMatchObject({ externalId: "u-1", instrument: "EURUSD", direction: "long", entryPrice: 1.085, exitPrice: 1.087, stopLoss: 1.084, profit: 18.5, profitIsNet: true });
    expect(t.openedAt).toBe("2024-03-15T10:00:00.000Z");
    expect(r.errors).toEqual([
      { row: 3, code: "missingInstrument", field: "instrument" },
      { row: 4, code: "badTime", field: "openedAt" },
    ]);
    expect(Object.keys(suggestMapping(["Тикет", "Инструмент", "Направление", "Время открытия"]))).toEqual(["instrument", "direction", "openedAt", "externalId"]);
  });

  it("XLSX: stored and deflate-compressed sheets are read without extra libraries", async () => {
    const xlsx = tableToXlsx([
      ["Symbol", "Opening direction", "Opening time", "Closing time", "Entry price", "Closing price", "Closing Quantity", "Net $"],
      ["EURUSD", "Buy", "2024-03-04 10:00:00", "2024-03-04 11:00:00", 1.08, 1.081, 1000, 1],
    ]);
    const { tables } = await readImportFile("history.xlsx", xlsx, MAX);
    const det = detectFormat(tables)!;
    expect(det.parser.id).toBe("ctrader");
    expect(det.parser.parse(det.table, { timeZone: "UTC" }).trades[0]).toMatchObject({ instrument: "EURUSD", entryPrice: 1.08, size: 1000 });

    // deflate entry
    const data = new TextEncoder().encode("hello hello hello");
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(data);
        c.close();
      },
    });
    const deflated = new Uint8Array(await new Response(src.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer());
    const zip = new Uint8Array(30 + 5 + deflated.length + 46 + 5 + 22);
    const v = new DataView(zip.buffer);
    const name = new TextEncoder().encode("a.txt");
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, 8, true);
    v.setUint32(18, deflated.length, true);
    v.setUint16(26, 5, true);
    zip.set(name, 30);
    zip.set(deflated, 35);
    const c = 35 + deflated.length;
    v.setUint32(c, 0x02014b50, true);
    v.setUint16(c + 10, 8, true);
    v.setUint32(c + 20, deflated.length, true);
    v.setUint16(c + 28, 5, true);
    v.setUint32(c + 42, 0, true);
    zip.set(name, c + 46);
    const e = c + 51;
    v.setUint32(e, 0x06054b50, true);
    v.setUint16(e + 10, 1, true);
    v.setUint32(e + 16, c, true);
    const files = await readZip(zip);
    expect(new TextDecoder().decode(files.get("a.txt"))).toBe("hello hello hello");
  });

  it("rejects too large and empty files", async () => {
    expect((await readImportFile("a.csv", new Uint8Array(0), MAX)).error).toBe("empty");
    expect((await readImportFile("a.csv", new Uint8Array(11), 10)).error).toBe("tooLarge");
  });

  it("every parser declares how it was checked", () => {
    for (const id of ["mt4", "binance", "universal", "ayra"] as const) expect(["verified", "documented"]).toContain(getParser(id).verification);
  });
});

const settings = (over: Partial<ImportSettings> = {}): ImportSettings => ({
  formatId: "mt4",
  accountId: "acc1",
  batchId: "b1",
  rMode: "none",
  nowIso: "2026-01-01T00:00:00.000Z",
  ...over,
});

const nt = (over: Partial<NormalizedTrade> = {}): NormalizedTrade => ({
  externalId: "1",
  instrument: "eurusd",
  direction: "long",
  openedAt: "2024-03-04T10:00:00.000Z",
  closedAt: "2024-03-04T11:00:00.000Z",
  entryPrice: 1.1,
  exitPrice: 1.102,
  stopLoss: 1.099,
  size: 1,
  profit: 200,
  commission: 7,
  swap: -1,
  rows: [2],
  ...over,
});

describe("normalization, R and duplicates", () => {
  it("builds an imported trade: net P&L, no invented R, batch and key", () => {
    const t = buildTrade(nt(), settings(), 0);
    expect(t).toMatchObject({
      instrument: "EURUSD",
      status: "closed",
      pnlMoney: 192,
      fees: 7,
      swap: -1,
      rMultiple: undefined,
      result: "win",
      verification: "imported",
      source: "import",
      importBatchId: "b1",
      importKey: "mt4:1",
      emotions: [],
      attachmentIds: [],
    });
  });

  it("R from the stop loss or from a fixed risk; empty when there is no risk information", () => {
    expect(buildTrade(nt(), settings({ rMode: "stopLoss" }), 0).rMultiple).toBe(2);
    expect(buildTrade(nt({ stopLoss: undefined }), settings({ rMode: "stopLoss" }), 0).rMultiple).toBeUndefined();
    expect(buildTrade(nt(), settings({ rMode: "fixedRisk", fixedRisk: 96 }), 0)).toMatchObject({ rMultiple: 2, riskAmount: 96 });
  });

  it("duplicates: existing ticket, same content, twice in one file; re-import adds nothing", () => {
    const first = buildPreview([nt(), nt({ externalId: "2", openedAt: "2024-03-05T10:00:00.000Z" })], [], settings());
    expect(first.map((r) => r.status)).toEqual(["new", "new"]);
    const saved: Trade[] = first.map((r) => r.trade);
    const again = buildPreview([nt(), nt({ externalId: "2", openedAt: "2024-03-05T10:00:00.000Z" })], saved, settings({ batchId: "b2" }));
    expect(again.every((r) => r.status === "duplicate")).toBe(true);
    const noTicket = buildPreview([nt({ externalId: undefined }), nt({ externalId: undefined })], [], settings());
    expect(noTicket.map((r) => r.status)).toEqual(["new", "duplicateInFile"]);
    const manual = { ...saved[0], id: "manual", importKey: undefined, source: "manual" } as Trade;
    expect(buildPreview([nt({ externalId: "other" })], [manual], settings())[0].status).toBe("duplicate");
  });
});

describe("export", () => {
  const trade = buildTrade(nt({ instrument: "=HYPERLINK(1)" }), settings(), 0);
  const ctx = {
    accounts: [{ id: "acc1", name: "Main", type: "personal" as const, currency: "USD" as const, platform: "manual" as const, createdAt: "", startBalance: 10000 }],
    strategies: [],
    includeNotes: false,
    labels: {
      column: (c: string) => c,
      direction: (d: string) => d,
      mistake: (m: string) => m,
      ruleCheck: (v: string) => v,
      defaultAccount: "Main",
      defaultStrategy: "Strategy",
    },
  };

  it("CSV: BOM, numbers as numbers, formula injection guarded", () => {
    const csv = tableToCsv(tradesToTable([trade], ctx));
    expect(csv.startsWith("﻿openedAt,closedAt,account,instrument")).toBe(true);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain(",192,");
    expect(guardCell(-5)).toBe("-5");
    expect(guardCell("-5 lots")).toBe("'-5 lots");
    expect(guardCell("@SUM")).toBe("'@SUM");
    expect(exportFileName("csv", new Date(2026, 9, 14))).toBe("ayra-trades-2026-10-14.csv");
  });

  it("XLSX export can be read back", async () => {
    const bytes = tableToXlsx(tradesToTable([trade], ctx));
    const { tables } = await readImportFile("x.xlsx", bytes, MAX);
    expect(tables[0].rows[0][3]).toBe("instrument");
    expect(tables[0].rows[1][3]).toBe("'=HYPERLINK(1)");
    expect(Number(tables[0].rows[1][10])).toBe(192);
  });

  it("JSON v1.2 round trip: export → import gives the same trades", async () => {
    const original: Trade = {
      ...buildTrade(nt(), settings(), 0),
      id: "tr_orig",
      source: "manual",
      verification: "unverified",
      importBatchId: undefined,
      importKey: undefined,
      externalId: undefined,
      rMultiple: 1.5,
      emotions: ["calm"],
      mistakes: ["fomo"],
      notes: "plan followed",
      entryReason: "breakout",
      executionRating: 4,
      attachmentIds: ["att1"],
    };
    const json = tradesToJson([original], { accounts: ctx.accounts, strategies: [], notes: [] }, true);
    expect(JSON.parse(json)).toMatchObject({ app: "ayra", kind: "trades", exportVersion: "1.2" });
    const { tables } = await readImportFile("t.json", new TextEncoder().encode(json), MAX);
    const det = detectFormat(tables)!;
    expect(det.parser.id).toBe("ayra");
    const parsed = det.parser.parse(det.table, { timeZone: "UTC" });
    const [row] = buildPreview(parsed.trades, [], settings({ formatId: "ayra", accountId: "acc9", batchId: "b9" }));
    const { accountId, importBatchId, importKey, externalId, updatedAt, attachmentIds, ...rest } = row.trade;
    const { accountId: _a, importBatchId: _b, importKey: _k, externalId: _e, updatedAt: _u, attachmentIds: _att, ...expected } = original;
    expect(rest).toEqual(expected);
    expect({ accountId, importBatchId, importKey, externalId, attachmentIds }).toEqual({
      accountId: "acc9",
      importBatchId: "b9",
      importKey: "ayra:tr_orig",
      externalId: "tr_orig",
      attachmentIds: [],
    });
    expect(updatedAt).toBeTruthy();
    // importing the same file into the same journal again: duplicate
    expect(buildPreview(parsed.trades, [row.trade], settings({ formatId: "ayra" }))[0].status).toBe("duplicate");
  });

  it("JSON without notes strips notes, entry reason and checklist", () => {
    const json = JSON.parse(tradesToJson([{ ...trade, notes: "x", entryReason: "y", ruleChecks: { r: "passed" } }], { accounts: [], strategies: [], notes: [] }, false));
    expect(json.trades[0].notes).toBeUndefined();
    expect(json.trades[0].entryReason).toBeUndefined();
    expect(json.trades[0].ruleChecks).toBeUndefined();
    expect(json.trades[0].attachmentIds).toBeUndefined();
  });
});
