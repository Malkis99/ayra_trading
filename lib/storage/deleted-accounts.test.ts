import { describe, it, expect, beforeEach } from "vitest";
import { AppStorage } from "./index";

// Q4.7-Б1: once this device knows an account was deleted on the server, nothing is written into that account's space
// again (a tab that still had it open cannot bring the erased copy back); other spaces are not affected.
const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";

describe("Q4.7-Б1 deleted accounts on this device", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });

  it("a deleted account's space takes no write; another account and the guest still do", () => {
    AppStorage.setItem("ayra_demo_v1", "{}", A);
    AppStorage.markAccountDeleted(A);
    AppStorage.setItem("ayra_demo_v1", '{"xp":1}', A);
    AppStorage.setItem("ayra_journal_v1", "{}", A);
    expect(localStorage.getItem(`ayra:${A}:ayra_demo_v1`)).toBe("{}");
    expect(localStorage.getItem(`ayra:${A}:ayra_journal_v1`)).toBeNull();
    AppStorage.setItem("ayra_demo_v1", "{}", B);
    expect(localStorage.getItem(`ayra:${B}:ayra_demo_v1`)).toBe("{}");
    AppStorage.setUserId(null);
    AppStorage.setItem("ayra_demo_v1", "{}");
    expect(localStorage.getItem("ayra_demo_v1")).toBe("{}");
  });

  it("a guarded write bound to the deleted account's space is not written either", () => {
    AppStorage.setUserId(A);
    AppStorage.markAccountDeleted(A);
    AppStorage.guardedSetItem("ayra_demo_v1", "{}", `account:${A}`);
    expect(localStorage.getItem(`ayra:${A}:ayra_demo_v1`)).toBeNull();
  });

  it("the copy still kept on this device is offered; after erasing, nothing is offered; the mark stays", () => {
    AppStorage.setItem("ayra_demo_v1", "{}", A);
    AppStorage.markAccountDeleted(A);
    AppStorage.markAccountDeleted(A);
    expect(AppStorage.deletedAccounts()).toEqual([A]);
    expect(AppStorage.deletedAccountsWithLocalData()).toEqual([A]);
    AppStorage.clear(A);
    expect(AppStorage.deletedAccountsWithLocalData()).toEqual([]);
    expect(AppStorage.isAccountDeleted(A)).toBe(true);
  });

  it("a broken list is read as empty (nothing blocked by mistake)", () => {
    localStorage.setItem("ayra_deleted_accounts", "not json");
    expect(AppStorage.deletedAccounts()).toEqual([]);
    AppStorage.setItem("ayra_demo_v1", "{}", A);
    expect(localStorage.getItem(`ayra:${A}:ayra_demo_v1`)).toBe("{}");
  });
});
