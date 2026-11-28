import { describe, expect, it } from "vitest";
import { JOURNAL_TABS, journalTab, tradeDays, tradeDayPages, tradeDaySummary } from "./trades-view";
import type { Account, Trade } from "./types";
const usd: Account = { id: "usd", name: "USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-01-01T00:00:00Z" };
const eur: Account = { ...usd, id: "eur", currency: "EUR", startBalance: 20000 };
const trade = (id: string, extra: Partial<Trade> = {}): Trade => ({ id, accountId: "usd", instrument: "EURUSD", direction: "long", status: "closed", openedAt: "2026-11-01T03:30:00Z", pnlMoney: 100, rMultiple: 1, result: "win", emotions: [], mistakes: [], verification: "imported", source: "import", schemaVersion: 5, createdAt: "2026-11-01T03:30:00Z", updatedAt: "2026-11-01T03:30:00Z", ...extra });
describe("J2.1 navigation and read-only trade presentation", () => {
  it("orders all seven tabs and keeps analytics deep links compatible", () => {
    expect(JOURNAL_TABS).toEqual(["dashboard", "trades", "plan", "notes", "reports", "strategies", "accounts"]);
    expect(journalTab("analytics")).toBe("dashboard"); expect(journalTab("dashboard")).toBe("dashboard");
    expect(journalTab(null)).toBe("dashboard"); expect(journalTab("garbage")).toBe("dashboard");
  });
  it("groups the complete filtered data by profile day across DST, without changing records", () => {
    const rows = [trade("a"), trade("b", { openedAt: "2026-11-01T06:30:00Z" })]; const before = structuredClone(rows);
    expect(tradeDays(rows, "America/New_York", "date", "desc").map(g => g.dateKey)).toEqual(["2026-11-01", "2026-10-31"]);
    expect(tradeDays(rows, "Asia/Tbilisi", "date", "desc")).toHaveLength(1); expect(rows).toEqual(before);
  });
  it("keeps each day intact beyond 50 rows and resets to an empty page safely", () => {
    const rows = Array.from({ length: 51 }, (_, n) => trade(String(n)));
    const days = tradeDays(rows, "UTC", "date", "desc");
    expect(tradeDayPages(days, 50)[0][0].trades).toHaveLength(51);
    expect(tradeDayPages(days, 50)).toHaveLength(1); expect(tradeDayPages([], 50)).toEqual([[]]);
  });
  it("sorts within complete days and retains unknown dates", () => {
    const days = tradeDays([trade("a"), trade("b", { instrument: "AUDUSD" }), trade("c", { openedAt: "bad", createdAt: "bad" })], "UTC", "instrument", "asc");
    expect(days.find(d => d.dateKey === "2026-11-01")!.trades.map(t => t.id)).toEqual(["b", "a"]);
    expect(days.find(d => d.dateKey === "unknown")!.trades[0].id).toBe("c");
  });
  it("never sums currencies or reports an open position as a realised win", () => {
    const s = tradeDaySummary([trade("a"), trade("b", { accountId: "eur", pnlMoney: -50, result: "loss" }), trade("c", { status: "open", pnlMoney: 9999 })], [usd, eur]);
    expect(s.money).toEqual([{ currency: "USD", value: 100 }, { currency: "EUR", value: -50 }]);
    expect(s.percent).toBeNull(); expect(s.wins).toBe(1); expect(s.losses).toBe(1); expect(s.open).toBe(1); expect(s.netR).toBe(2);
  });
  it("distinguishes missing results, partial results and an actual zero", () => {
    expect(tradeDaySummary([trade("a", { rMultiple: undefined, pnlMoney: undefined })], [usd]).netR).toBeNull();
    const partial = tradeDaySummary([trade("a"), trade("b", { rMultiple: undefined, pnlMoney: undefined })], [usd]);
    expect(partial.partialR).toBe(true); expect(partial.partialMoney).toBe(true); expect(partial.percent).toBeNull();
    const zero = tradeDaySummary([trade("a", { pnlMoney: 0, rMultiple: 0, result: "breakeven" })], [usd]);
    expect(zero.netR).toBe(0); expect(zero.money[0].value).toBe(0); expect(zero.breakeven).toBe(1);
  });
  it("uses a distinct initial balance per account and refuses a zero or missing base", () => {
    const rows = [trade("a"), trade("b")]; expect(tradeDaySummary(rows, [usd]).percent).toBe(2);
    expect(tradeDaySummary(rows, [{ ...usd, startBalance: 0 }]).percent).toBeNull();
    expect(tradeDaySummary(rows, []).money).toEqual([]);
  });
  it("sorts comparable displayed results only and never adds fees twice", () => {
    const rows = [trade("money", { rMultiple: undefined, pnlMoney: 100000 }), trade("r", { rMultiple: 2, pnlMoney: 200, fees: 20 }), trade("eur", { accountId: "eur", rMultiple: undefined, pnlMoney: 500 })];
    expect(tradeDays(rows, "UTC", "result", "desc", "R", [usd, eur])[0].trades[0].id).toBe("r");
    expect(tradeDays(rows, "UTC", "result", "desc", "money", [usd, eur])[0].trades.map(t => t.id)).toEqual(["eur", "money", "r"]);
    expect(tradeDaySummary([rows[1]], [usd]).money[0].value).toBe(200);
  });
});
