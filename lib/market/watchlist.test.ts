import { describe, expect, it } from "vitest";
import { INSTRUMENT_IDS, INSTRUMENTS, instrumentBySymbol, CATEGORIES, CORE_IDS } from "./instruments";
import { WATCHLIST_LIMIT, addTo, emptyWatchlist, isFull, move, normalizeChartPrefs, normalizeWatchlist, removeFrom } from "./watchlist";

describe("the Market catalog", () => {
  it("every category and the core point at catalog instruments; each instrument is in a category", () => {
    const inCategories = new Set(CATEGORIES.flatMap((c) => c.ids));
    for (const id of INSTRUMENT_IDS) expect(inCategories.has(id)).toBe(true);
    for (const id of CORE_IDS) expect(INSTRUMENT_IDS).toContain(id);
    expect(Object.keys(INSTRUMENTS).sort()).toEqual([...INSTRUMENT_IDS].sort());
  });
  it("a TradingView symbol from a widget click finds its instrument; others do not", () => {
    expect(instrumentBySymbol("FX:EURUSD")?.id).toBe("eurusd");
    expect(instrumentBySymbol("fx:eurusd")?.id).toBe("eurusd");
    expect(instrumentBySymbol("NASDAQ:AAPL")).toBeUndefined();
    expect(instrumentBySymbol(null)).toBeUndefined();
  });
});

describe("the Watchlist (PR 1.3)", () => {
  it("add, no duplicates, remove", () => {
    let w = emptyWatchlist();
    w = addTo(w, "eurusd");
    w = addTo(w, "btc");
    expect(addTo(w, "eurusd")).toBe(w);
    expect(w.ids).toEqual(["eurusd", "btc"]);
    expect(removeFrom(w, "eurusd").ids).toEqual(["btc"]);
    expect(removeFrom(w, "gold")).toBe(w);
  });

  it("up and down; the ends stay", () => {
    const w = { version: 1 as const, ids: ["eurusd", "btc", "gold"] as const }.ids.reduce((acc, id) => addTo(acc, id), emptyWatchlist());
    expect(move(w, "btc", -1).ids).toEqual(["btc", "eurusd", "gold"]);
    expect(move(w, "btc", 1).ids).toEqual(["eurusd", "gold", "btc"]);
    expect(move(w, "eurusd", -1)).toBe(w);
    expect(move(w, "gold", 1)).toBe(w);
    expect(move(w, "dxy", 1)).toBe(w);
  });

  it(`at most ${WATCHLIST_LIMIT}`, () => {
    // the catalog has fewer than 30 instruments today, so the limit is checked on stored data and on the rules
    expect(WATCHLIST_LIMIT).toBe(30);
    const full = { version: 1 as const, ids: Array.from({ length: WATCHLIST_LIMIT }, () => "eurusd" as const) };
    expect(isFull(full)).toBe(true);
    expect(addTo(full, "btc")).toBe(full);
  });

  it("stored data: only catalog instruments, each once, broken data → empty", () => {
    expect(normalizeWatchlist({ version: 1, ids: ["btc", "nope", "btc", 5, "gold"] }).ids).toEqual(["btc", "gold"]);
    expect(normalizeWatchlist(null).ids).toEqual([]);
    expect(normalizeWatchlist("x").ids).toEqual([]);
    expect(normalizeWatchlist({ ids: "btc" }).ids).toEqual([]);
  });

  it("chart prefs: DXY and 1 hour by default, wrong values ignored", () => {
    expect(normalizeChartPrefs(null)).toMatchObject({ instrument: "dxy", interval: "60" });
    expect(normalizeChartPrefs({ instrument: "gold", interval: "240" })).toMatchObject({ instrument: "gold", interval: "240" });
    expect(normalizeChartPrefs({ instrument: "aapl", interval: "2" })).toMatchObject({ instrument: "dxy", interval: "60" });
  });
});
