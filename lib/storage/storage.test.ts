import { describe, it, expect, beforeEach } from "vitest";
import {
  AppStorage,
  buildKey,
  parseKey,
  validateUserId,
  validateKeyName,
  STORAGE_SCHEMA_KEY,
} from "./index";
import { DEVICE_KEYS, isDeviceKey } from "./device-keys";
import { IndexedDBAttachmentRepository } from "./indexeddb-repository";
import "fake-indexeddb/auto";

const USER_A_ID = "11111111-1111-1111-1111-111111111111";
const USER_B_ID = "22222222-2222-2222-2222-222222222222";

describe("AppStorage & Device Keys Unit Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });

  describe("1. Device Keys Whitelist & Checks", () => {
    it("correctly identifies registered device keys", () => {
      expect(isDeviceKey("ayra_lang")).toBe(true);
      expect(isDeviceKey("ayra_guest_dismissed")).toBe(true);
      expect(isDeviceKey("ayra_guest_banner_dismissed")).toBe(true);
      expect(isDeviceKey("ayra_awakening_lease")).toBe(true);
      expect(isDeviceKey("ayra_auth_event")).toBe(true);
      expect(isDeviceKey("ayra_mock_auth_v1")).toBe(true);
      expect(isDeviceKey("ayra_demo_v1")).toBe(false);
      expect(isDeviceKey("ayra_journal_v1")).toBe(false);
    });

    it("verifies device keys contain no personal data or tokens", () => {
      DEVICE_KEYS.forEach((key) => {
        expect(key).not.toMatch(/@/);
        expect(key).not.toMatch(/token|secret|password|jwt/i);
      });
    });
  });

  describe("2. Key Validation & Formatting (buildKey & parseKey)", () => {
    it("validates valid UUIDs and mock user IDs", () => {
      expect(() => validateUserId(USER_A_ID)).not.toThrow();
      expect(() => validateUserId("mock-user-id-12345")).not.toThrow();
      expect(() => validateUserId("invalid-user-id")).toThrow();
      expect(() => validateUserId("")).toThrow();
    });

    it("validates keyNames (disallows colons and whitespace)", () => {
      expect(() => validateKeyName("ayra_demo_v1")).not.toThrow();
      expect(() => validateKeyName("invalid:key")).toThrow();
      expect(() => validateKeyName("invalid key")).toThrow();
      expect(() => validateKeyName("")).toThrow();
    });

    it("builds correct canonical keys", () => {
      // Device key
      expect(buildKey({ isGuest: false, userId: USER_A_ID }, "ayra_lang")).toBe("ayra_lang");

      // Guest space key
      expect(buildKey({ isGuest: true }, "ayra_demo_v1")).toBe("ayra_demo_v1");

      // User space key
      expect(buildKey({ isGuest: false, userId: USER_A_ID }, "ayra_demo_v1")).toBe(
        `ayra:${USER_A_ID}:ayra_demo_v1`
      );
    });

    it("parses raw storage keys into correct space and keyName", () => {
      expect(parseKey("ayra_lang")).toEqual({
        isDevice: true,
        isGuest: false,
        userId: null,
        keyName: "ayra_lang",
      });

      expect(parseKey("ayra_demo_v1")).toEqual({
        isDevice: false,
        isGuest: true,
        userId: null,
        keyName: "ayra_demo_v1",
      });

      expect(parseKey(`ayra:${USER_A_ID}:ayra_demo_v1`)).toEqual({
        isDevice: false,
        isGuest: false,
        userId: USER_A_ID,
        keyName: "ayra_demo_v1",
      });
    });
  });

  describe("3. Storage Isolation (Guest vs Account A vs Account B)", () => {
    it("isolates data completely between guest, Account A, and Account B", () => {
      // 1. Write as Guest
      AppStorage.setUserId(null);
      AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "GuestTrader" }));

      // 2. Write as Account A
      AppStorage.setUserId(USER_A_ID);
      AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "TraderA" }));

      // 3. Write as Account B
      AppStorage.setUserId(USER_B_ID);
      AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "TraderB" }));

      // Verify localStorage keys directly
      expect(localStorage.getItem("ayra_demo_v1")).toBe(
        JSON.stringify({ name: "GuestTrader" })
      );
      expect(localStorage.getItem(`ayra:${USER_A_ID}:ayra_demo_v1`)).toBe(
        JSON.stringify({ name: "TraderA" })
      );
      expect(localStorage.getItem(`ayra:${USER_B_ID}:ayra_demo_v1`)).toBe(
        JSON.stringify({ name: "TraderB" })
      );

      // Verify reading through AppStorage
      AppStorage.setUserId(null);
      expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!)).toEqual({
        name: "GuestTrader",
      });

      AppStorage.setUserId(USER_A_ID);
      expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!)).toEqual({
        name: "TraderA",
      });

      AppStorage.setUserId(USER_B_ID);
      expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!)).toEqual({
        name: "TraderB",
      });
    });

    it("maintains device-wide keys unprefixed across all account switches", () => {
      AppStorage.setUserId(null);
      AppStorage.setItem("ayra_lang", "ru");

      AppStorage.setUserId(USER_A_ID);
      expect(AppStorage.getItem("ayra_lang")).toBe("ru");

      AppStorage.setItem("ayra_lang", "en");

      AppStorage.setUserId(USER_B_ID);
      expect(AppStorage.getItem("ayra_lang")).toBe("en");

      expect(localStorage.getItem("ayra_lang")).toBe("en");
    });
  });

  describe("4. Re-reading after Reload Simulation", () => {
    it("persists and re-reads user data correctly after state reset", () => {
      AppStorage.setUserId(USER_A_ID);
      AppStorage.setItem("ayra_journal_v1", JSON.stringify({ trades: [{ id: "t1" }] }));

      // Simulate app restart / reload by clearing memory reference and re-setting
      AppStorage.setUserId(null);
      expect(AppStorage.getItem("ayra_journal_v1")).toBeNull();

      AppStorage.setUserId(USER_A_ID);
      const data = JSON.parse(AppStorage.getItem("ayra_journal_v1")!);
      expect(data).toEqual({ trades: [{ id: "t1" }] });
    });
  });

  describe("5. T6d & T7a.3 Migration & Backward Compatibility", () => {
    it("preserves pre-existing T6d journal data in guest space", () => {
      const legacyT6dJournal = {
        schemaVersion: 5,
        primaryPropAccountId: "prop_acc_1",
        accounts: [{ id: "prop_acc_1", type: "prop", name: "FTMO 100K" }],
        trades: [{ id: "trade_101", pnlMoney: 500 }],
        strategies: [],
        noTrades: [],
        plans: [],
        weekPlans: [],
        notes: [],
      };

      // Populate legacy unprefixed key in localStorage
      localStorage.setItem("ayra_journal_v1", JSON.stringify(legacyT6dJournal));

      // AppStorage initialized -> schema version tag set in guest space
      AppStorage.ensureSchemaVersion();
      expect(localStorage.getItem(STORAGE_SCHEMA_KEY)).toBe("1");

      // Verify legacy data is untouched and returned for guest
      AppStorage.setUserId(null);
      const guestJournal = JSON.parse(AppStorage.getItem("ayra_journal_v1")!);
      expect(guestJournal.primaryPropAccountId).toBe("prop_acc_1");
      expect(guestJournal.trades).toHaveLength(1);

      // Account A starts with clean state
      AppStorage.setUserId(USER_A_ID);
      expect(AppStorage.getItem("ayra_journal_v1")).toBeNull();
    });

    it("preserves pre-existing T7a.3 onboarding/game data in guest space", () => {
      const legacyT7a3Game = {
        name: "LegacyTrader",
        level: 3,
        xp: 160,
        onboarding: {
          status: "done",
          answers: { ageRange: "25-34", market: "forex" },
        },
      };

      localStorage.setItem("ayra_demo_v1", JSON.stringify(legacyT7a3Game));

      AppStorage.setUserId(null);
      const guestGame = JSON.parse(AppStorage.getItem("ayra_demo_v1")!);
      expect(guestGame.name).toBe("LegacyTrader");
      expect(guestGame.onboarding.status).toBe("done");

      AppStorage.setUserId(USER_A_ID);
      expect(AppStorage.getItem("ayra_demo_v1")).toBeNull();
    });
  });

  describe("6. IndexedDB Attachment Repository Isolation", () => {
    it("resolves distinct database names for guest, User A, and User B", () => {
      expect(AppStorage.getAttachmentDbName(null)).toBe("ayra_attachments_v1");
      expect(AppStorage.getAttachmentDbName(USER_A_ID)).toBe(
        `ayra:${USER_A_ID}:ayra_attachments_v1`
      );
      expect(AppStorage.getAttachmentDbName(USER_B_ID)).toBe(
        `ayra:${USER_B_ID}:ayra_attachments_v1`
      );
    });

    it("isolates attachments between User A and User B IndexedDB databases", async () => {
      const repoA = new IndexedDBAttachmentRepository(USER_A_ID);
      const repoB = new IndexedDBAttachmentRepository(USER_B_ID);

      const dummyBlob = new Blob(["test"], { type: "image/webp" });
      const attA = await repoA.addAttachment({
        tradeId: "trade_a",
        kind: "before",
        width: 100,
        height: 100,
        bytes: 1024,
        mime: "image/webp",
        hash: "hash_a",
        originalBlob: dummyBlob,
        previewBlob: dummyBlob,
      });

      const itemsA = await repoA.getAttachmentsByTradeId("trade_a");
      expect(itemsA).toHaveLength(1);
      expect(itemsA[0].id).toBe(attA.id);

      // User B cannot see User A's attachment
      const itemsB = await repoB.getAttachmentsByTradeId("trade_a");
      expect(itemsB).toHaveLength(0);
    });
  });
});
