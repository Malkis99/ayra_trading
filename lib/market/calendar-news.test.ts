import { describe, expect, it } from "vitest";
import {
  CALENDAR_COUNTRIES,
  DEFAULT_CALENDAR_NEWS,
  eventsOptions,
  IMPORTANCE,
  normalizeCalendarNews,
  sameClock,
  timelineOptions,
  toggleIn,
} from "./calendar-news";
import { mergeMarket, type MarketCloudRow, type MarketLocal } from "./cloud-sync";
import { DEFAULT_CHART_VIEW } from "./chart-workspace";
import { normalizeChartPrefs, type Watchlist } from "./watchlist";
import { normalizeSettings } from "./sessions";

const T = (h: number) => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
const empty = (): MarketLocal => ({
  watchlist: { version: 1, ids: [] } as Watchlist,
  view: { ...DEFAULT_CHART_VIEW },
  notes: {},
  prefs: normalizeChartPrefs(null),
  sessions: normalizeSettings(null),
  calendar: normalizeCalendarNews(null),
});

describe("Market 1.4: calendar and news filters", () => {
  it("defaults, and reading back keeps the offered order, drops unknown values, never leaves a filter empty", () => {
    expect(normalizeCalendarNews(null)).toEqual(DEFAULT_CALENDAR_NEWS);
    expect(normalizeCalendarNews({ importance: ["low", "high", "x"], countries: ["jp", "us", "ru"], newsInstrument: "gold", updatedAt: T(1) })).toEqual({
      importance: ["high", "low"],
      countries: ["us", "jp"],
      newsInstrument: "gold",
      updatedAt: T(1),
    });
    expect(normalizeCalendarNews({ importance: [], countries: ["xx"], newsInstrument: "AAPL!" })).toEqual(DEFAULT_CALENDAR_NEWS);
  });

  it("toggling keeps the order and the last option on", () => {
    expect(toggleIn(["high"], "low", IMPORTANCE)).toEqual(["high", "low"]);
    expect(toggleIn(["high", "low"], "high", IMPORTANCE)).toEqual(["low"]);
    expect(toggleIn(["us"], "us", CALENDAR_COUNTRIES)).toEqual(["us"]);
  });

  it("the calendar widget gets TradingView's codes", () => {
    expect(eventsOptions({ ...DEFAULT_CALENDAR_NEWS, importance: ["high", "medium", "low"], countries: ["us", "eu"] })).toMatchObject({ importanceFilter: "1,0,-1", countryFilter: "us,eu" });
    expect(eventsOptions(DEFAULT_CALENDAR_NEWS)).toMatchObject({ importanceFilter: "1,0", countryFilter: "us,eu,gb,jp" });
  });

  it("the news follow the chosen instrument's catalog symbol, or show the top stories; compact on phones", () => {
    expect(timelineOptions(DEFAULT_CALENDAR_NEWS, false)).toMatchObject({ feedMode: "all_symbols", displayMode: "regular" });
    expect(timelineOptions(DEFAULT_CALENDAR_NEWS, false)).not.toHaveProperty("symbol");
    expect(timelineOptions({ ...DEFAULT_CALENDAR_NEWS, newsInstrument: "eurusd" }, true)).toMatchObject({ feedMode: "symbol", symbol: "FX:EURUSD", displayMode: "compact" });
  });

  it("tells when the device's clock differs from the profile's zone", () => {
    const at = new Date(T(12));
    expect(sameClock("Asia/Tbilisi", "Asia/Tbilisi", at)).toBe(true);
    expect(sameClock("Asia/Tbilisi", "Asia/Yerevan", at)).toBe(true); // both UTC+4
    expect(sameClock("Asia/Tbilisi", "America/New_York", at)).toBe(false);
  });

  it("follow the account in the chart_view row under `calendar`, merged apart from the view and the sessions", () => {
    const pushed = mergeMarket({ ...empty(), calendar: { ...DEFAULT_CALENDAR_NEWS, countries: ["us"], newsInstrument: "btc", updatedAt: T(3) } }, [], false, new Date(T(12)));
    const row = pushed.push.find((p) => p.id === "chart_view")!;
    expect(row.data.calendar).toMatchObject({ countries: ["us"], newsInstrument: "btc", updatedAt: T(3) });
    expect(row.data).not.toHaveProperty("sessions");

    const cloud: MarketCloudRow[] = [
      {
        id: "chart_view",
        data: {
          id: "chart_view",
          ...DEFAULT_CHART_VIEW,
          updatedAt: T(6),
          sessions: { ...normalizeSettings(null), display: { kind: "utc" }, updatedAt: T(1) },
          calendar: { importance: ["high"], countries: ["jp"], newsInstrument: null, updatedAt: T(6) },
        },
      },
    ];
    const local = { ...empty(), sessions: { ...normalizeSettings(null), display: { kind: "profile" as const }, updatedAt: T(5) }, calendar: { ...DEFAULT_CALENDAR_NEWS, updatedAt: T(2) } };
    const r = mergeMarket(local, cloud, false, new Date(T(12)));
    expect(r.changed.calendar).toBe(true);
    expect(r.local.calendar).toMatchObject({ importance: ["high"], countries: ["jp"], updatedAt: T(6) });
    // the newer sessions here go up with the account's newer calendar part kept
    expect(r.push.find((p) => p.id === "chart_view")!.data).toMatchObject({ sessions: { display: { kind: "profile" } }, calendar: { countries: ["jp"] }, updatedAt: T(6) });
  });

  it("filters never changed here (no time) are not sent", () => {
    expect(mergeMarket(empty(), [], false, new Date(T(12))).push).toEqual([]);
  });
});
