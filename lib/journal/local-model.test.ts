import { describe, it, expect, beforeEach } from "vitest";
import v4 from "./__fixtures__/journal-v4.json";
import v5 from "./__fixtures__/journal-v5.json";
import { LocalStorageJournalRepository, CURRENT_JOURNAL_SCHEMA_VERSION, migrateJournalData } from "./repository";
import { tradesToJson, AYRA_TRADES_EXPORT_VERSION } from "./export";
import { ayraTradesFrom } from "./import/parsers/ayra";
import { summarizeSpace } from "@/lib/storage/profile-transfer";
import type { Trade } from "./types";

const KEY = "ayra_journal_v1";
const seed = (data: unknown) => localStorage.setItem(KEY, JSON.stringify(data));
const stored = () => JSON.parse(localStorage.getItem(KEY) || "{}");

describe("T7b-1 local journal model", () => {
  beforeEach(() => localStorage.clear());

  describe("migration of existing data (nothing is lost)", () => {
    it("v4 data: every record kept, updatedAt from the record (or createdAt), deletedAt null, legacy primary prop kept", () => {
      const m = migrateJournalData(v4 as Record<string, unknown>, new Date("2026-10-18T00:00:00Z"));
      expect(m.schemaVersion).toBe(CURRENT_JOURNAL_SCHEMA_VERSION);
      expect(m.accounts.map((a) => a.id)).toEqual(["acc_main", "acc_prop"]);
      expect(m.trades.map((t) => t.id)).toEqual(["tr_old_1", "tr_old_2"]);
      expect(m.strategies).toHaveLength(1);
      expect(m.noTrades).toHaveLength(1);
      expect(m.primaryPropAccountId).toBe("acc_prop");
      // accounts / strategies / no-trades had no updatedAt: it comes from createdAt
      expect(m.accounts[0].updatedAt).toBe("2026-03-01T09:00:00.000Z");
      expect(m.strategies[0].updatedAt).toBe("2026-03-01T09:30:00.000Z");
      expect(m.noTrades[0].updatedAt).toBe("2026-03-05T08:00:00.000Z");
      // trades keep their own updatedAt and all fields
      expect(m.trades[0].updatedAt).toBe("2026-03-03T11:05:00.000Z");
      expect(m.trades[0].pnlMoney).toBe(120);
      expect(m.trades[1].mistakes).toEqual(["early_entry"]);
      for (const list of [m.accounts, m.trades, m.strategies, m.noTrades]) for (const r of list) expect(r.deletedAt).toBeNull();
      expect(m.plans).toEqual([]);
      expect(m.notes).toEqual([]);
    });

    it("v5 data through the repository: same records and fields, archived stays archived, saved as v6", () => {
      seed(v5);
      const repo = new LocalStorageJournalRepository();
      expect(repo.getAccounts()).toHaveLength(2);
      expect(repo.getAccount("acc_old")?.archivedAt).toBe("2026-04-10T09:00:00.000Z");
      const t = repo.getTrade("tr_v5_1")!;
      expect(t.processScore).toBe(80);
      expect(t.ruleChecks).toEqual({ r1: "passed" });
      expect(t.attachmentIds).toEqual(["att_1"]);
      expect(t.updatedAt).toBe("2026-04-03T09:00:00.000Z");
      expect(repo.getTradingPlan("2026-04-02")?.note).toBe("London only");
      expect(repo.getWeekPlan("2026-03-30")?.goals).toEqual(["3 clean days"]);
      expect(repo.getNote("n_1")?.pinned).toBe(true);
      expect(repo.getPrimaryPropAccountId()).toBeNull();

      repo.setPrimaryPropAccountId(null); // any write stores the new format
      const raw = stored();
      expect(raw.schemaVersion).toBe(CURRENT_JOURNAL_SCHEMA_VERSION);
      expect(raw.trades).toHaveLength(1);
      expect(raw.settingsUpdatedAt).toBeTruthy();
    });

    it("empty or broken storage gives an empty journal", () => {
      expect(new LocalStorageJournalRepository().getTrades()).toEqual([]);
      localStorage.setItem(KEY, "{not json");
      expect(new LocalStorageJournalRepository().getAccounts()).toEqual([]);
    });
  });

  describe("soft delete (tombstones)", () => {
    it("deleted records are hidden from every read but kept with deletedAt and a fresh updatedAt", () => {
      seed(v5);
      const repo = new LocalStorageJournalRepository();
      expect(repo.deleteTrade("tr_v5_1")).toBe(true);
      expect(repo.getTrades()).toEqual([]);
      expect(repo.getTrade("tr_v5_1")).toBeNull();
      expect(repo.deleteTrade("tr_v5_1")).toBe(false); // already deleted
      const tomb = repo.getAllRecords().trades.find((t) => t.id === "tr_v5_1")!;
      expect(tomb.deletedAt).toBeTruthy();
      expect(tomb.updatedAt).toBe(tomb.deletedAt);
      expect(tomb.pnlMoney).toBe(50); // the record itself is kept

      expect(repo.deleteNote("n_1")).toBe(true);
      expect(repo.deleteTradingPlan("2026-04-02")).toBe(true);
      expect(repo.deleteWeekPlan("2026-03-30")).toBe(true);
      expect(repo.getNotes()).toEqual([]);
      expect(repo.getTradingPlans()).toEqual([]);
      expect(repo.getWeekPlans()).toEqual([]);
      expect(repo.getAllRecords().notes).toHaveLength(1);
    });

    it("an account or strategy can be deleted once its trades are deleted; their tombstones stay", () => {
      seed(v5);
      const repo = new LocalStorageJournalRepository();
      expect(() => repo.deleteAccount("acc_main")).toThrow();
      expect(() => repo.deleteStrategy("st_v5")).toThrow();
      repo.deleteTrade("tr_v5_1");
      expect(repo.deleteAccount("acc_main")).toBe(true);
      expect(repo.deleteStrategy("st_v5")).toBe(true);
      expect(repo.getAccounts().map((a) => a.id)).toEqual(["acc_old"]);
      expect(repo.getStrategies()).toEqual([]);
      expect(repo.getAllRecords().accounts).toHaveLength(2);
    });

    it("saving a record with the id (or date) of a tombstone brings it back as live", () => {
      seed(v5);
      const repo = new LocalStorageJournalRepository();
      repo.deleteTradingPlan("2026-04-02");
      const plan = repo.getAllRecords().plans[0];
      repo.saveTradingPlan({ ...plan, note: "New plan", deletedAt: undefined });
      expect(repo.getTradingPlan("2026-04-02")?.note).toBe("New plan");
      expect(repo.getAllRecords().plans).toHaveLength(1);
    });

    it("every save stamps updatedAt", () => {
      seed(v5);
      const repo = new LocalStorageJournalRepository();
      const before = repo.getAccount("acc_main")!.updatedAt!;
      const saved = repo.saveAccount({ ...repo.getAccount("acc_main")!, name: "Main" });
      expect(saved.updatedAt! > before).toBe(true);
      expect(saved.deletedAt).toBeNull();
    });
  });

  describe("import and undo with tombstones", () => {
    it("undo import soft-deletes the batch; importing the same file again brings the trades back", () => {
      seed(v5);
      const repo = new LocalStorageJournalRepository();
      expect(repo.deleteTradesByBatch("imp_test")).toBe(1);
      expect(repo.getTrades()).toEqual([]);
      const again = repo.getAllRecords().trades[0];
      expect(repo.importTrades([{ ...again, deletedAt: null }])).toBe(1);
      expect(repo.getTrades()).toHaveLength(1);
      expect(repo.getAllRecords().trades).toHaveLength(1);
      // a live duplicate is skipped
      expect(repo.importTrades([again])).toBe(0);
    });
  });

  describe("AYRA JSON export / import compatibility", () => {
    const repoData = () => {
      seed(v5);
      return new LocalStorageJournalRepository();
    };

    it("export is v1.3, carries updatedAt and never contains deleted records or deletedAt", () => {
      const repo = repoData();
      const all = repo.getAllRecords();
      const tomb: Trade = { ...all.trades[0], id: "tr_deleted", deletedAt: "2026-10-01T00:00:00.000Z" };
      const json = JSON.parse(
        tradesToJson([...repo.getTrades(), tomb], { accounts: all.accounts, strategies: all.strategies, notes: all.notes }, true)
      );
      expect(json.exportVersion).toBe("1.3");
      expect(AYRA_TRADES_EXPORT_VERSION).toBe("1.3");
      expect(json.trades.map((t: Trade) => t.id)).toEqual(["tr_v5_1"]);
      expect(JSON.stringify(json)).not.toContain("deletedAt");
      expect(json.accounts[0].updatedAt).toBeTruthy();
    });

    it("older files (1.0–1.2) and full profile exports are still imported; deleted records are skipped", () => {
      const base = { app: "ayra", kind: "trades", trades: [{ id: "a", instrument: "XAUUSD", direction: "long", openedAt: "2026-04-01T10:00:00Z" }] };
      expect(ayraTradesFrom({ ...base, exportVersion: "1.0" })).toHaveLength(1);
      expect(ayraTradesFrom({ ...base, exportVersion: "1.2" })).toHaveLength(1);
      expect(ayraTradesFrom({ ...base, exportVersion: "1.3" })).toHaveLength(1);
      expect(ayraTradesFrom({ ...base, exportVersion: "2.0" })).toBeNull();
      const withTomb = { ...base, exportVersion: "1.3", trades: [...base.trades, { ...base.trades[0], id: "b", deletedAt: "2026-05-01T00:00:00Z" }] };
      expect(ayraTradesFrom(withTomb)?.map((t) => t.id)).toEqual(["a"]);
      expect(ayraTradesFrom({ app: "ayra", exportVersion: "1.4", journal: { trades: withTomb.trades } })?.map((t) => t.id)).toEqual(["a"]);
    });
  });

  it("guest data summary ignores tombstones (an all-deleted journal is not 'data')", () => {
    seed({ ...v5, trades: v5.trades.map((t) => ({ ...t, deletedAt: "2026-05-01T00:00:00Z" })), accounts: [], notes: [] });
    expect(summarizeSpace(null).tradesCount).toBe(0);
  });
});
