import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppStorage, GUEST_SPACE_ID } from "@/lib/storage";

const USER_A_ID = "11111111-1111-1111-1111-111111111111";
const USER_B_ID = "22222222-2222-2222-2222-222222222222";

describe("T7a-B2 Active Space Unit Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });

  it("1. Space change resets memory references and reads correct space data", () => {
    // Write as Guest
    AppStorage.setUserId(null);
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "GuestUser" }));

    // Switch to User A
    AppStorage.setUserId(USER_A_ID);
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "UserA" }));

    // Verify isolation
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!).name).toBe("UserA");

    // Switch back to Guest
    AppStorage.setUserId(null);
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!).name).toBe("GuestUser");
  });

  it("2. Stale write bound to space A is dropped when current active space is B", () => {
    AppStorage.setUserId(USER_A_ID);
    const boundSpaceId = AppStorage.getActiveSpaceId(); // "account:USER_A_ID"

    // Space changes to User B
    AppStorage.setUserId(USER_B_ID);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Attempt writing to space A using guardedSetItem
    const success = AppStorage.guardedSetItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "StaleA" }),
      boundSpaceId
    );

    expect(success).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Write dropped")
    );

    // Verify User B's storage remains empty
    expect(AppStorage.getItem("ayra_demo_v1")).toBeNull();

    consoleSpy.mockRestore();
  });

  it("3. Flush before switch forcibly completes pending operations for space A", async () => {
    AppStorage.setUserId(USER_A_ID);
    const spaceAId = AppStorage.getActiveSpaceId();

    let flushExecuted = false;
    const unregister = AppStorage.registerFlushHandler(async (targetSpaceId) => {
      if (targetSpaceId === spaceAId) {
        AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "FlushedA" }), USER_A_ID);
        flushExecuted = true;
      }
    });

    // Execute flush for space A
    const res = await AppStorage.flushSpace(spaceAId);
    expect(res.success).toBe(true);
    expect(flushExecuted).toBe(true);

    // Switch to User B
    AppStorage.setUserId(USER_B_ID);
    expect(AppStorage.getItem("ayra_demo_v1")).toBeNull();

    // Verify User A has the flushed data
    AppStorage.setUserId(USER_A_ID);
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!).name).toBe("FlushedA");

    unregister();
  });

  it("4. Logout returns guest space and preserves account data on device", () => {
    // Guest data
    AppStorage.setUserId(null);
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "GuestTrader" }));

    // User A login
    AppStorage.setUserId(USER_A_ID);
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "AccountA" }));

    // Logout -> Guest space
    AppStorage.setUserId(null);
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!).name).toBe("GuestTrader");

    // Re-login User A -> Account A data preserved
    AppStorage.setUserId(USER_A_ID);
    expect(JSON.parse(AppStorage.getItem("ayra_demo_v1")!).name).toBe("AccountA");
  });

  it("5. Account B cannot read memory or storage of Account A", () => {
    AppStorage.setUserId(USER_A_ID);
    AppStorage.setItem("ayra_journal_v1", JSON.stringify({ secret: "AccountASecret" }));

    AppStorage.setUserId(USER_B_ID);
    expect(AppStorage.getItem("ayra_journal_v1")).toBeNull();
  });

  it("6. Device-wide keys persist across space switches without prefixing", () => {
    AppStorage.setUserId(null);
    AppStorage.setItem("ayra_lang", "ru");

    AppStorage.setUserId(USER_A_ID);
    expect(AppStorage.getItem("ayra_lang")).toBe("ru");

    AppStorage.setUserId(USER_B_ID);
    expect(AppStorage.getItem("ayra_lang")).toBe("ru");
  });
});
