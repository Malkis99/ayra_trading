import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_VIEW, NOTE_LIMIT, normalizeChartView, normalizeFavorites, normalizeNotes, toggleFavorite, withNote } from "./chart-workspace";
import { normalizeChartPrefs } from "./watchlist";

describe("favourite timeframes (PR 1.3b)", () => {
  it("1m, 5m, 15m, 1h, 4h, 1D by default; broken data → the default", () => {
    expect(normalizeFavorites(undefined)).toEqual(["1", "5", "15", "60", "240", "D"]);
    expect(normalizeFavorites(["x"])).toEqual(["1", "5", "15", "60", "240", "D"]);
    expect(normalizeChartPrefs(null).favorites).toEqual(["1", "5", "15", "60", "240", "D"]);
  });
  it("kept in the canonical order, unknown values dropped", () => {
    expect(normalizeFavorites(["D", "30", "zz", "1"])).toEqual(["1", "30", "D"]);
  });
  it("add and remove; the last one stays", () => {
    expect(toggleFavorite(["5", "60"], "30")).toEqual(["5", "30", "60"]);
    expect(toggleFavorite(["5", "60"], "5")).toEqual(["60"]);
    expect(toggleFavorite(["60"], "60")).toEqual(["60"]);
  });
});

describe("the view (PR 1.3b)", () => {
  it("all on, list on the right, notes under the chart by default", () => {
    expect(normalizeChartView(null)).toEqual(DEFAULT_CHART_VIEW);
    expect(DEFAULT_CHART_VIEW).toEqual({ watchlist: true, watchlistSide: "right", watchlistFolded: false, notes: true, notesPlace: "below", drawing: true, clock: "top" });
  });
  it("the time and session card: right on top by default, the four places kept, anything else → the default", () => {
    for (const clock of ["top", "bottom", "strip", "hidden"]) expect(normalizeChartView({ clock }).clock).toBe(clock);
    expect(normalizeChartView({ clock: "left" }).clock).toBe("top");
  });
  it("stored values kept, wrong ones replaced", () => {
    expect(normalizeChartView({ watchlist: false, watchlistSide: "left", notesPlace: "side", drawing: false, notes: "yes" })).toEqual({
      watchlist: false,
      watchlistSide: "left",
      watchlistFolded: false,
      notes: true,
      notesPlace: "side",
      drawing: false,
      clock: "top",
    });
    expect(normalizeChartView({ watchlistSide: "top", notesPlace: "top" })).toMatchObject({ watchlistSide: "right", notesPlace: "below" });
  });
});

describe("notes per instrument (PR 1.3b)", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  it("set, replace, clear with empty text", () => {
    let n = withNote({}, "btc", "Уровень 76 000", now);
    expect(n.btc).toEqual({ text: "Уровень 76 000", updatedAt: "2026-11-01T10:00:00.000Z" });
    n = withNote(n, "gold", "Золото: жду новости", now);
    expect(Object.keys(n).sort()).toEqual(["btc", "gold"]);
    n = withNote(n, "btc", "   ", now);
    expect(n.btc).toBeUndefined();
  });
  it(`at most ${NOTE_LIMIT} characters`, () => {
    expect(withNote({}, "btc", "x".repeat(NOTE_LIMIT + 50), now).btc?.text).toHaveLength(NOTE_LIMIT);
  });
  it("stored data: only catalog instruments and real text", () => {
    expect(normalizeNotes({ btc: { text: "ok", updatedAt: "2026-11-01T10:00:00Z" }, zzzz: { text: "no" }, gold: { text: "" }, eth: "x" })).toEqual({
      btc: { text: "ok", updatedAt: "2026-11-01T10:00:00Z" },
    });
    expect(normalizeNotes(null)).toEqual({});
  });
});
