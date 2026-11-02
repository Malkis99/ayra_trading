import { describe, expect, it } from "vitest";
import { joinWatchlists, mergeMarket, type MarketCloudRow, type MarketLocal } from "./cloud-sync";
import { MarketCloudError, syncMarketOnce, type MarketCloudRemote, type MarketLocalStore } from "./cloud-sync-engine";
import { DEFAULT_CHART_VIEW, withNote, noteText } from "./chart-workspace";
import { normalizeChartPrefs, type Watchlist } from "./watchlist";
import { normalizeSettings } from "./sessions";

const T = (h: number) => new Date(Date.UTC(2026, 10, 2, h)).toISOString();
const list = (ids: string[], at?: string): Watchlist => ({ version: 1, ids: ids as Watchlist["ids"], ...(at ? { updatedAt: at } : {}) });
const empty = (): MarketLocal => ({ watchlist: list([]), view: { ...DEFAULT_CHART_VIEW }, notes: {}, prefs: normalizeChartPrefs(null), sessions: normalizeSettings(null) });
const now = new Date(T(12));

describe("Market data in the account: merge (newest wins; the first time the Watchlists are joined)", () => {
  it("the first sync joins the device's list with the account's, without duplicates, the account's first", () => {
    expect(joinWatchlists(list(["btc", "gold"], T(1)), list(["gold", "eurusd"], T(2)), now)).toEqual(list(["btc", "gold", "eurusd"], T(12)));
    // nothing new on the device: the account's list as it is (nothing to send)
    expect(joinWatchlists(list(["btc"], T(1)), list(["btc"], T(5)), now)).toEqual(list(["btc"], T(1)));
    const r = mergeMarket({ ...empty(), watchlist: list(["eurusd"], T(5)) }, [{ id: "watchlist", data: { id: "watchlist", ids: ["btc"], updatedAt: T(1) } }], true, now);
    expect(r.local.watchlist.ids).toEqual(["btc", "eurusd"]);
    expect(r.changed.watchlist).toBe(true);
    expect(r.push.find((p) => p.id === "watchlist")?.data).toEqual({ id: "watchlist", ids: ["btc", "eurusd"], updatedAt: T(12) });
  });

  it("after the first sync: the newest list wins as a whole (removals reach the other device)", () => {
    const cloud: MarketCloudRow[] = [{ id: "watchlist", data: { id: "watchlist", ids: ["btc", "gold"], updatedAt: T(3) } }];
    const older = mergeMarket({ ...empty(), watchlist: list(["btc"], T(2)) }, cloud, false, now);
    expect(older.local.watchlist.ids).toEqual(["btc", "gold"]);
    expect(older.push).toEqual([]);
    const newer = mergeMarket({ ...empty(), watchlist: list(["btc"], T(4)) }, cloud, false, now);
    expect(newer.local.watchlist.ids).toEqual(["btc"]);
    expect(newer.push.map((p) => p.id)).toEqual(["watchlist"]);
  });

  it("an empty cloud gets what the device has; an untouched device sends nothing", () => {
    const r = mergeMarket({ ...empty(), watchlist: list(["btc"], T(1)), view: { ...DEFAULT_CHART_VIEW, clock: "bottom", updatedAt: T(1) } }, [], true, now);
    expect(r.push.map((p) => p.id).sort()).toEqual(["chart_view", "watchlist"]);
    expect(mergeMarket(empty(), [], true, now).push).toEqual([]);
  });

  it("the chart view: the newest wins", () => {
    const cloud: MarketCloudRow[] = [{ id: "chart_view", data: { id: "chart_view", ...DEFAULT_CHART_VIEW, clock: "strip", updatedAt: T(5) } }];
    expect(mergeMarket({ ...empty(), view: { ...DEFAULT_CHART_VIEW, clock: "hidden", updatedAt: T(4) } }, cloud, false, now).local.view.clock).toBe("strip");
    const mine = mergeMarket({ ...empty(), view: { ...DEFAULT_CHART_VIEW, clock: "hidden", updatedAt: T(6) } }, cloud, false, now);
    expect(mine.local.view.clock).toBe("hidden");
    expect(mine.push.map((p) => p.id)).toEqual(["chart_view"]);
  });

  it("notes one by one; a cleared note (tombstone) reaches the other device", () => {
    const local = { ...empty(), notes: { btc: { text: "76 000", updatedAt: T(2) }, gold: { text: "news", updatedAt: T(4) } } };
    const cloud: MarketCloudRow[] = [
      { id: "note:btc", data: { id: "note:btc", text: "", updatedAt: T(3), deletedAt: T(3) } },
      { id: "note:eth", data: { id: "note:eth", text: "ETH", updatedAt: T(1) } },
      { id: "note:gold", data: { id: "note:gold", text: "old", updatedAt: T(1) } },
    ];
    const r = mergeMarket(local, cloud, false, now);
    expect(noteText(r.local.notes, "btc")).toBe("");
    expect(noteText(r.local.notes, "eth")).toBe("ETH");
    expect(noteText(r.local.notes, "gold")).toBe("news");
    expect(r.push).toEqual([{ id: "note:gold", data: { id: "note:gold", text: "news", updatedAt: T(4) } }]);
  });

  it("clearing leaves a tombstone; writing again brings it back", () => {
    const at = new Date(T(3));
    const cleared = withNote({ btc: { text: "x", updatedAt: T(1) } }, "btc", "", at);
    expect(cleared.btc).toEqual({ text: "", updatedAt: T(3), deletedAt: T(3) });
    expect(withNote(cleared, "btc", "y", new Date(T(4))).btc).toEqual({ text: "y", updatedAt: T(4) });
    // nothing to clear: no tombstone
    expect(withNote({}, "btc", "", at)).toEqual({});
  });
});

/** A cloud that keeps the newest version of every row, as the 0008 trigger does. */
function fakeCloud(enabled = true) {
  const rows = new Map<string, MarketCloudRow>();
  const calls = { upsert: 0 };
  const remote = (userId: string | null): MarketCloudRemote => ({
    currentUserId: async () => userId,
    isSyncEnabled: async () => enabled,
    fetchAll: async () => [...rows.values()],
    upsert: async (list) => {
      calls.upsert++;
      for (const r of list) {
        const old = rows.get(r.id);
        if (!old || Date.parse(String(r.data.updatedAt)) >= Date.parse(String(old.data.updatedAt))) rows.set(r.id, r);
      }
    },
  });
  return { rows, calls, remote };
}

function device(userId: string, start: MarketLocal = empty()): MarketLocalStore & { data: MarketLocal } {
  let joined = false;
  const d = {
    data: structuredClone(start),
    userId: () => userId,
    read: () => structuredClone(d.data),
    write: (next: MarketLocal) => {
      d.data = structuredClone(next);
    },
    joined: () => joined,
    markJoined: () => {
      joined = true;
    },
  };
  return d;
}

describe("Market data in the account: the exchange", () => {
  it("two devices: a laptop's list reaches the phone; the phone's own list is joined, not lost", async () => {
    const cloud = fakeCloud();
    const laptop = device("u1", { ...empty(), watchlist: list(["btc", "gold"], T(1)), notes: { btc: { text: "76 000", updatedAt: T(1) } } });
    expect(await syncMarketOnce(cloud.remote("u1"), laptop, () => now)).toEqual({ kind: "on" });
    const phone = device("u1", { ...empty(), watchlist: list(["eurusd"], T(2)) });
    expect(await syncMarketOnce(cloud.remote("u1"), phone, () => now)).toEqual({ kind: "on" });
    expect(phone.data.watchlist.ids).toEqual(["btc", "gold", "eurusd"]);
    expect(noteText(phone.data.notes, "btc")).toBe("76 000");
    // the laptop gets the joined list on its next exchange
    await syncMarketOnce(cloud.remote("u1"), laptop, () => now);
    expect(laptop.data.watchlist.ids).toEqual(["btc", "gold", "eurusd"]);
    // later the phone removes gold: the newest list wins on the laptop too
    phone.data.watchlist = list(["btc", "eurusd"], T(13));
    await syncMarketOnce(cloud.remote("u1"), phone, () => new Date(T(13)));
    await syncMarketOnce(cloud.remote("u1"), laptop, () => new Date(T(13)));
    expect(laptop.data.watchlist.ids).toEqual(["btc", "eurusd"]);
  });

  it("the switch off, a guest or another account: nothing is sent", async () => {
    const off = fakeCloud(false);
    expect(await syncMarketOnce(off.remote("u1"), device("u1", { ...empty(), watchlist: list(["btc"], T(1)) }))).toEqual({ kind: "flagOff" });
    const on = fakeCloud();
    expect(await syncMarketOnce(on.remote(null), device("u1", { ...empty(), watchlist: list(["btc"], T(1)) }))).toEqual({ kind: "guest" });
    expect(await syncMarketOnce(on.remote("u2"), device("u1", { ...empty(), watchlist: list(["btc"], T(1)) }))).toEqual({ kind: "waiting" });
    expect(off.calls.upsert + on.calls.upsert).toBe(0);
  });

  it("a network error is reported, the device's data stays", async () => {
    const d = device("u1", { ...empty(), watchlist: list(["btc"], T(1)) });
    const broken: MarketCloudRemote = { currentUserId: async () => "u1", isSyncEnabled: async () => true, fetchAll: async () => Promise.reject(new Error("offline")), upsert: async () => {} };
    expect(await syncMarketOnce(broken, d)).toEqual({ kind: "offline" });
    expect(d.data.watchlist.ids).toEqual(["btc"]);
  });
});

describe("the chart settings in the account (owner 2026-11-02): favourites, chart type, indicators, layout", () => {
  const prefs = (patch: Record<string, unknown>) => normalizeChartPrefs({ ...patch });

  it("go to the account in the chart_view row, with their own time; the instrument and timeframe stay on the device", () => {
    const local = { ...empty(), prefs: prefs({ instrument: "gold", interval: "5", style: "2", indicators: ["rsi"], layout: 4, link: true, sharedUpdatedAt: T(3) }) };
    const r = mergeMarket(local, [], false, now);
    const row = r.push.find((p) => p.id === "chart_view")!;
    expect(row.data.chart).toMatchObject({ style: "2", indicators: ["rsi"], layout: 4, link: true, updatedAt: T(3) });
    expect(row.data.chart).not.toHaveProperty("instrument");
    expect(row.data.chart).not.toHaveProperty("interval");
    expect(row.data.updatedAt).toBe(T(3));
  });

  it("the newer settings from the account come in; this device's instrument and timeframe are kept", () => {
    const cloud: MarketCloudRow[] = [
      { id: "chart_view", data: { id: "chart_view", ...DEFAULT_CHART_VIEW, updatedAt: T(5), viewUpdatedAt: T(1), chart: { favorites: ["5", "60"], style: "8", indicators: ["macd"], layout: 2, link: false, updatedAt: T(5) } } },
    ];
    const local = { ...empty(), prefs: prefs({ instrument: "btc", interval: "240", sharedUpdatedAt: T(2) }) };
    const r = mergeMarket(local, cloud, false, now);
    expect(r.changed.prefs).toBe(true);
    expect(r.local.prefs).toMatchObject({ instrument: "btc", interval: "240", favorites: ["5", "60"], style: "8", indicators: ["macd"], layout: 2, sharedUpdatedAt: T(5) });
    expect(r.push).toEqual([]);
  });

  it("the view and the settings merge separately: a newer view here and newer settings in the account both survive", () => {
    const cloud: MarketCloudRow[] = [
      { id: "chart_view", data: { id: "chart_view", ...DEFAULT_CHART_VIEW, clock: "top", updatedAt: T(6), viewUpdatedAt: T(1), chart: { favorites: ["1"], style: "9", indicators: [], layout: 1, link: false, updatedAt: T(6) } } },
    ];
    const local = { ...empty(), view: { ...DEFAULT_CHART_VIEW, clock: "hidden" as const, updatedAt: T(4) }, prefs: prefs({ style: "2", sharedUpdatedAt: T(2) }) };
    const r = mergeMarket(local, cloud, false, now);
    expect(r.local.view.clock).toBe("hidden");
    expect(r.local.prefs.style).toBe("9");
    const row = r.push.find((p) => p.id === "chart_view")!;
    expect(row.data).toMatchObject({ clock: "hidden", viewUpdatedAt: T(4), updatedAt: T(6), chart: { style: "9", updatedAt: T(6) } });
  });

  it("a row written before the settings joined (only updatedAt) still reads the view's time", () => {
    const cloud: MarketCloudRow[] = [{ id: "chart_view", data: { id: "chart_view", ...DEFAULT_CHART_VIEW, clock: "strip", updatedAt: T(5) } }];
    const r = mergeMarket({ ...empty(), view: { ...DEFAULT_CHART_VIEW, updatedAt: T(4) } }, cloud, false, now);
    expect(r.local.view.clock).toBe("strip");
    expect(r.changed.prefs).toBe(false);
  });

  it("two devices: the laptop's layout and indicators reach the phone, the phone keeps its own instrument", async () => {
    const cloud = fakeCloud();
    const laptop = device("u1", { ...empty(), prefs: prefs({ instrument: "eurusd", style: "8", indicators: ["rsi", "bb"], layout: 4, favorites: ["5", "15", "60"], sharedUpdatedAt: T(1) }) });
    await syncMarketOnce(cloud.remote("u1"), laptop, () => now);
    const phone = device("u1", { ...empty(), prefs: prefs({ instrument: "btc", interval: "D" }) });
    await syncMarketOnce(cloud.remote("u1"), phone, () => now);
    expect(phone.data.prefs).toMatchObject({ instrument: "btc", interval: "D", style: "8", indicators: ["rsi", "bb"], layout: 4, favorites: ["5", "15", "60"] });
  });
});

describe("the sessions block's settings follow the account (in the chart_view row, no new migration)", () => {
  const settings = (patch: Partial<ReturnType<typeof normalizeSettings>>) => ({ ...normalizeSettings(null), ...patch });

  it("a change here goes up under `sessions` with its own time; the view and chart parts are not touched", () => {
    const local = { ...empty(), sessions: settings({ display: { kind: "utc" }, updatedAt: T(3) }) };
    const r = mergeMarket(local, [], false, now);
    const row = r.push.find((p) => p.id === "chart_view")!;
    expect(row.data.sessions).toMatchObject({ display: { kind: "utc" }, updatedAt: T(3) });
    expect(row.data.updatedAt).toBe(T(3));
    expect(row.data).not.toHaveProperty("chart");
  });

  it("newer settings from the account come in, older ones do not", () => {
    const cloud: MarketCloudRow[] = [
      { id: "chart_view", data: { id: "chart_view", ...DEFAULT_CHART_VIEW, updatedAt: T(5), sessions: { ...settings({ display: { kind: "zone", zone: "Asia/Tokyo" } }), updatedAt: T(5) } } },
    ];
    const taken = mergeMarket({ ...empty(), sessions: settings({ display: { kind: "utc" }, updatedAt: T(2) }) }, cloud, false, now);
    expect(taken.changed.sessions).toBe(true);
    expect(taken.local.sessions).toMatchObject({ display: { kind: "zone", zone: "Asia/Tokyo" }, updatedAt: T(5) });
    expect(taken.push).toEqual([]);
    const kept = mergeMarket({ ...empty(), sessions: settings({ display: { kind: "utc" }, updatedAt: T(7) }) }, cloud, false, now);
    expect(kept.changed.sessions).toBe(false);
    expect(kept.push.find((p) => p.id === "chart_view")!.data.sessions).toMatchObject({ display: { kind: "utc" }, updatedAt: T(7) });
  });

  it("settings never changed here (no time) wait for the account's and are not sent", () => {
    const r = mergeMarket(empty(), [], false, now);
    expect(r.push).toEqual([]);
    expect(r.changed.sessions).toBe(false);
  });

  it("the view, the chart settings and the sessions merge separately: all three newest parts survive", () => {
    const cloud: MarketCloudRow[] = [
      {
        id: "chart_view",
        data: {
          id: "chart_view",
          ...DEFAULT_CHART_VIEW,
          clock: "top",
          updatedAt: T(6),
          viewUpdatedAt: T(1),
          chart: { favorites: ["1"], style: "9", indicators: [], layout: 1, link: false, updatedAt: T(6) },
          sessions: { ...settings({ display: { kind: "profile" } }), updatedAt: T(2) },
        },
      },
    ];
    const local = { ...empty(), view: { ...DEFAULT_CHART_VIEW, clock: "hidden" as const, updatedAt: T(4) }, sessions: settings({ display: { kind: "utc" }, updatedAt: T(5) }) };
    const r = mergeMarket(local, cloud, false, now);
    const row = r.push.find((p) => p.id === "chart_view")!;
    expect(row.data).toMatchObject({ clock: "hidden", updatedAt: T(6), chart: { style: "9" }, sessions: { display: { kind: "utc" }, updatedAt: T(5) } });
  });

  it("two devices: the laptop's session hours reach the phone", async () => {
    const cloud = fakeCloud();
    const laptop = device("u1", { ...empty(), sessions: settings({ display: { kind: "zone", zone: "Europe/London" }, updatedAt: T(1) }) });
    await syncMarketOnce(cloud.remote("u1"), laptop, () => now);
    const phone = device("u1", empty());
    await syncMarketOnce(cloud.remote("u1"), phone, () => now);
    expect(phone.data.sessions.display).toEqual({ kind: "zone", zone: "Europe/London" });
  });
});

describe("the sync says what is wrong (owner 2026-11-02: it must not fail silently)", () => {
  const remoteWith = (error: unknown): MarketCloudRemote => ({
    currentUserId: async () => "u1",
    isSyncEnabled: async () => true,
    fetchAll: async () => Promise.reject(error),
    upsert: async () => {},
  });

  it("the Market table missing in the cloud (0008 not applied) → «noTable»", async () => {
    expect(await syncMarketOnce(remoteWith(new MarketCloudError("PGRST205", "Could not find the table 'public.market_user_data' in the schema cache")), device("u1"))).toEqual({ kind: "noTable" });
    expect(await syncMarketOnce(remoteWith(new MarketCloudError("42P01", 'relation "public.market_user_data" does not exist')), device("u1"))).toEqual({ kind: "noTable" });
  });

  it("the cloud refused (rights, checks) → «refused» with its text; no answer → «offline»", async () => {
    expect(await syncMarketOnce(remoteWith(new MarketCloudError("42501", "new row violates row-level security policy")), device("u1"))).toEqual({
      kind: "refused",
      detail: "42501: new row violates row-level security policy",
    });
    expect(await syncMarketOnce(remoteWith(new TypeError("Failed to fetch")), device("u1"))).toEqual({ kind: "offline" });
  });
});
