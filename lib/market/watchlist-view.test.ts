import { describe, expect, it } from "vitest";
import { PICKER_CATEGORIES } from "./instruments";
import { moveVisible, visibleWatchlistIds } from "./watchlist-view";
import { normalizeWatchlist } from "./watchlist";

const names = { gold: "Золото" };
const list = normalizeWatchlist({ ids: ["eurusd", "btc", "gbpusd", "gold", "us10y", "aapl", "dxy"], updatedAt: "2026-11-20T12:00:00Z" });
describe("Watchlist view without changing its cloud format", () => {
  it("searches only saved instruments by localized name, ticker and provider symbol", () => {
    expect(visibleWatchlistIds(list, "  зОЛото ", "all", names)).toEqual(["gold"]);
    expect(visibleWatchlistIds(list, "GBPuSd", "all", names)).toEqual(["gbpusd"]);
    expect(visibleWatchlistIds(list, "NASDAQ:AAPL", "all", names)).toEqual(["aapl"]);
    expect(visibleWatchlistIds(list, "msft", "all", names)).toEqual([]);
  });
  it("supports all six picker categories including stocks, and combines category with query", () => {
    expect(PICKER_CATEGORIES).toHaveLength(6);
    for (const category of PICKER_CATEGORIES) expect(visibleWatchlistIds(list, "", category.id, names).length).toBeGreaterThan(0);
    expect(visibleWatchlistIds(list, "gold", "stocks", names)).toEqual([]);
    expect(visibleWatchlistIds(list, "", "all", names)).toEqual(list.ids);
  });
  it("intersects pins, category and search without reordering, including moves around hidden instruments", () => {
    const pinned = (id: string) => ["eurusd", "gbpusd", "gold"].includes(id);
    expect(visibleWatchlistIds(list, "usd", "forex", names, pinned)).toEqual(["eurusd", "gbpusd"]);
    expect(visibleWatchlistIds(list, "", "all", names, pinned)).toEqual(["eurusd", "gbpusd", "gold"]);
    expect(moveVisible(list, "gold", -1, "", "all", names, pinned).ids).toEqual(["eurusd", "btc", "gold", "gbpusd", "us10y", "aapl", "dxy"]);
    expect(list.ids).toEqual(["eurusd", "btc", "gbpusd", "gold", "us10y", "aapl", "dxy"]);
  });
  it("moves filtered neighbours while every hidden instrument keeps its original index", () => {
    const next = moveVisible(list, "gbpusd", -1, "", "forex", names);
    expect(next.ids).toEqual(["gbpusd", "btc", "eurusd", "gold", "us10y", "aapl", "dxy"]);
    expect(moveVisible(list, "gbpusd", -1, "usd", "forex", names).ids).toEqual(next.ids);
    expect(list.ids[0]).toBe("eurusd");
    expect(next.updatedAt).toBe(list.updatedAt);
    expect(Object.keys(next).sort()).toEqual(Object.keys(list).sort());
  });
  it("does not change anything at a visible boundary or for an absent/filtered-out instrument", () => {
    expect(moveVisible(list, "eurusd", -1, "", "forex", names)).toBe(list);
    expect(moveVisible(list, "gbpusd", 1, "", "forex", names)).toBe(list);
    expect(moveVisible(list, "gold", -1, "", "forex", names)).toBe(list);
    expect(moveVisible(list, "msft", -1, "", "all", names)).toBe(list);
    expect(moveVisible(list, "eurusd", 1, "eurusd", "all", names)).toBe(list);
  });
});
