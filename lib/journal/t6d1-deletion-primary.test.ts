import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolvePrimaryPropAccount } from "./prop";
import { LocalStorageJournalRepository } from "./repository";
import { Account, Trade } from "./types";
import { ru } from "../i18n/dictionaries/ru";
import { en } from "../i18n/dictionaries/en";

describe("T6d.1 - Primary Prop Selection, Soft Delete & Deletion Constraints", () => {
  const mockPropAccount1: Account = {
    id: "prop_1",
    name: "Prop Account 1",
    type: "prop",
    currency: "USD",
    startBalance: 50000,
    platform: "manual",
    createdAt: "2026-01-01T00:00:00Z",
    propRules: {
      phaseLabel: "Phase 1",
      initialBalance: 50000,
      startedAt: "2026-05-01T00:00:00Z",
    },
  };

  const mockPropAccount2: Account = {
    id: "prop_2",
    name: "Prop Account 2",
    type: "prop",
    currency: "USD",
    startBalance: 100000,
    platform: "manual",
    createdAt: "2026-01-02T00:00:00Z",
    propRules: {
      phaseLabel: "Phase 2",
      initialBalance: 100000,
      startedAt: "2026-05-01T00:00:00Z",
    },
  };

  const mockRealAccount: Account = {
    id: "real_1",
    name: "Real Account",
    type: "personal",
    currency: "USD",
    startBalance: 10000,
    platform: "manual",
    createdAt: "2026-01-01T00:00:00Z",
  };

  const mockTrade: Trade = {
    id: "trade_1",
    accountId: "prop_1",
    instrument: "EURUSD",
    direction: "long",
    status: "closed",
    openedAt: "2026-05-01T10:00:00Z",
    closedAt: "2026-05-01T12:00:00Z",
    pnlMoney: 500,
    result: "win",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
    schemaVersion: 5,
  };

  describe("resolvePrimaryPropAccount", () => {
    it("returns null when primaryPropAccountId is explicitly null", () => {
      const accounts = [mockPropAccount1, mockPropAccount2];
      const res = resolvePrimaryPropAccount(accounts, null);
      expect(res).toBeNull();
    });

    it("returns account matching primaryPropAccountId string", () => {
      const accounts = [mockPropAccount1, mockPropAccount2];
      const res = resolvePrimaryPropAccount(accounts, "prop_2");
      expect(res?.id).toBe("prop_2");
    });

    it("falls back to auto selection when primaryPropAccountId is undefined", () => {
      const accounts = [mockPropAccount1, mockPropAccount2];
      const res = resolvePrimaryPropAccount(accounts, undefined);
      expect(res?.id).toBe("prop_1");
    });

    it("falls back to auto selection if specified account ID is archived or not found", () => {
      const archivedProp: Account = { ...mockPropAccount1, archivedAt: "2026-05-02T00:00:00Z" };
      const accounts = [archivedProp, mockPropAccount2];
      const res = resolvePrimaryPropAccount(accounts, "prop_1");
      expect(res?.id).toBe("prop_2");
    });
  });

  describe("Repository Schema Migration v5", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("migrates legacy isPrimaryProp flag to primaryPropAccountId", () => {
      const legacyData = {
        schemaVersion: 4,
        accounts: [
          { ...mockPropAccount1, isPrimaryProp: false },
          { ...mockPropAccount2, isPrimaryProp: true },
        ],
        trades: [],
        strategies: [],
        noTrades: [],
        plans: [],
        weekPlans: [],
        notes: [],
      };
      localStorage.setItem("ayra_journal_v1", JSON.stringify(legacyData));

      const repo = new LocalStorageJournalRepository();
      expect(repo.getPrimaryPropAccountId()).toBe("prop_2");
      repo.setPrimaryPropAccountId("prop_2"); // Triggers saveData
      const raw = JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}");
      expect(raw.schemaVersion).toBe(5);
    });

    it("persists primaryPropAccountId updates correctly", () => {
      const repo = new LocalStorageJournalRepository();
      repo.saveAccount(mockPropAccount1);
      repo.saveAccount(mockPropAccount2);

      repo.setPrimaryPropAccountId("prop_2");
      expect(repo.getPrimaryPropAccountId()).toBe("prop_2");

      repo.setPrimaryPropAccountId(null);
      expect(repo.getPrimaryPropAccountId()).toBeNull();

      repo.setPrimaryPropAccountId(undefined);
      expect(repo.getPrimaryPropAccountId()).toBeUndefined();
    });
  });

  describe("Account Deletion Constraints & Primary Prop State", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("prevents deletion of an account that has trades", () => {
      const repo = new LocalStorageJournalRepository();
      repo.saveAccount(mockPropAccount1);
      repo.saveTrade(mockTrade);

      expect(() => repo.deleteAccount("prop_1")).toThrow(
        /Cannot delete account with trades/i
      );
    });

    it("allows deletion of an account without trades", () => {
      const repo = new LocalStorageJournalRepository();
      repo.saveAccount(mockPropAccount1);

      repo.deleteAccount("prop_1");
      expect(repo.getAccounts().find((a) => a.id === "prop_1")).toBeUndefined();
    });
  });

  describe("i18n Dictionaries Completeness", () => {
    it("has all required confirmDialog keys in ru and en", () => {
      expect(ru.confirmDialog).toBeDefined();
      expect(en.confirmDialog).toBeDefined();

      expect(ru.confirmDialog.cancel).toBe("Отмена");
      expect(en.confirmDialog.cancel).toBe("Cancel");

      expect(ru.confirmDialog.confirm).toBe("Подтвердить");
      expect(en.confirmDialog.confirm).toBe("Confirm");

      expect(ru.confirmDialog.matchPrompt).toBeDefined();
      expect(en.confirmDialog.matchPrompt).toBeDefined();
    });

    it("has new primary prop selection keys in propRules", () => {
      expect(ru.journal.propRules.unsetPrimary).toBe("Снять отметку основного");
      expect(en.journal.propRules.unsetPrimary).toBe("Unset primary prop account");

      expect(ru.journal.propRules.autoSelectPrimary).toBe("Выбирать автоматически");
      expect(en.journal.propRules.autoSelectPrimary).toBe("Auto select");

      expect(ru.journal.propRules.noPrimarySelectedBanner).toBe("Основной проп-счёт не выбран");
      expect(en.journal.propRules.noPrimarySelectedBanner).toBe("Primary prop account not selected");

      expect(ru.journal.propRules.selectInAccounts).toBe("Выбрать в Счетах");
      expect(en.journal.propRules.selectInAccounts).toBe("Select in Accounts");
    });
  });
});
