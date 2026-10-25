import { describe, it, expect, beforeEach } from "vitest";
import { defaultAccountId, initialUnit, sanitizePreferences } from "./preferences";
import { LocalStorageJournalRepository } from "./repository";
import { snapshotEntries } from "./cloud/records";
import { applyEntries } from "./cloud/sync-merge";
import { AppStorage } from "@/lib/storage";

const accounts = [{ id: "acc_main" }, { id: "acc_prop" }];

describe("journal settings (setup plan PR 1)", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });

  it("only known values are kept", () => {
    expect(sanitizePreferences({ defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "london" })).toEqual({
      defaultUnit: "money",
      mainAccountId: "acc_prop",
      defaultSession: "london",
    });
    expect(sanitizePreferences({ defaultUnit: "points", defaultSession: "tokyo", mainAccountId: "" })).toBeUndefined();
    expect(sanitizePreferences(null)).toBeUndefined();
  });

  it("new trade / import account: main if active, else last used, else the first", () => {
    expect(defaultAccountId({ mainAccountId: "acc_prop" }, "acc_main", accounts)).toBe("acc_prop");
    expect(defaultAccountId({ mainAccountId: "acc_gone" }, "acc_main", accounts)).toBe("acc_main");
    expect(defaultAccountId({}, null, accounts)).toBe("acc_main");
    expect(defaultAccountId({}, null, [])).toBe("");
  });

  it("the Journal opens with the default unit, else the last switch, else R", () => {
    expect(initialUnit({ defaultUnit: "percent" }, "money")).toBe("percent");
    expect(initialUnit({}, "money")).toBe("money");
    expect(initialUnit(undefined, "garbage")).toBe("R");
  });

  it("stored in the journal and stamped for sync; travels in the journal_settings cloud row and back", () => {
    const repo = new LocalStorageJournalRepository();
    expect(repo.getPreferences()).toEqual({});
    repo.setPreferences({ defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "newyork" });
    const snap = repo.getAllRecords();
    expect(snap.settingsUpdatedAt).toBeTruthy();
    const row = snapshotEntries(snap, []).find((e) => e.table === "journal_settings")!;
    expect(row.record.preferences).toEqual({ defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "newyork" });

    const other = applyEntries({ ...snap, preferences: undefined }, [], [row]).snapshot;
    expect(other.preferences).toEqual({ defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "newyork" });
  });

  it("one account's settings are not visible in another account or the guest", () => {
    AppStorage.setUserId("00000000-0000-0000-0000-0000000000a1");
    new LocalStorageJournalRepository().setPreferences({ defaultUnit: "percent" });
    AppStorage.setUserId("00000000-0000-0000-0000-0000000000b1");
    expect(new LocalStorageJournalRepository().getPreferences()).toEqual({});
    AppStorage.setUserId(null);
    expect(new LocalStorageJournalRepository().getPreferences()).toEqual({});
    // and the account still has its own
    AppStorage.setUserId("00000000-0000-0000-0000-0000000000a1");
    expect(new LocalStorageJournalRepository().getPreferences()).toEqual({ defaultUnit: "percent" });
    AppStorage.setUserId(null);
  });
});
