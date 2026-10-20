import { describe, it, expect } from "vitest";
import { deviceJournalCounts } from "./device-counts";

describe("journal counters on this device (T7b-4f)", () => {
  it("one line per cloud table in the order of the cloud check; deleted not counted, archived counted", () => {
    const counts = deviceJournalCounts({
      accounts: [{ id: "a1" }, { id: "a2", isArchived: true }, { id: "a3", deletedAt: "2026-10-19T10:00:00.000Z" }] as never,
      trades: [{ id: "t1" }, { id: "t2", deletedAt: "2026-10-19T10:00:00.000Z" }] as never,
      notes: [{ id: "n1", isArchived: true }] as never,
      plans: [{ date: "2026-10-19" }] as never,
    });
    expect(counts).toEqual([
      { table: "journal_accounts", count: 2 },
      { table: "journal_trades", count: 1 },
      { table: "journal_strategies", count: 0 },
      { table: "journal_notes", count: 1 },
      { table: "journal_no_trades", count: 0 },
      { table: "journal_day_plans", count: 1 },
      { table: "journal_week_plans", count: 0 },
    ]);
  });
});
