import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireLease,
  renewLease,
  stealLease,
  releaseLease,
  getLeaseInfo,
  isLeaseOwner,
  isLeaseExpired,
} from "./awakening-lease";

describe("Awakening Lease Manager (T7a.3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("acquires lease when free", () => {
    const success = acquireLease("tab1");
    expect(success).toBe(true);

    const lease = getLeaseInfo();
    expect(lease?.ownerTabId).toBe("tab1");
    expect(isLeaseOwner("tab1")).toBe(true);
    expect(isLeaseOwner("tab2")).toBe(false);
  });

  it("rejects acquisition when lease held by another tab and not expired", () => {
    acquireLease("tab1");
    const success = acquireLease("tab2");
    expect(success).toBe(false);
    expect(isLeaseOwner("tab2")).toBe(false);
  });

  it("acquires lease when existing lease is expired", () => {
    acquireLease("tab1");

    // Fast-forward time past 15s TTL
    const lease = getLeaseInfo()!;
    lease.timestamp = Date.now() - 20000;
    localStorage.setItem("ayra_awakening_lease", JSON.stringify(lease));

    expect(isLeaseExpired(getLeaseInfo())).toBe(true);

    const success = acquireLease("tab2");
    expect(success).toBe(true);
    expect(isLeaseOwner("tab2")).toBe(true);
  });

  it("steals lease when requested explicitly", () => {
    acquireLease("tab1");
    stealLease("tab2");

    expect(isLeaseOwner("tab1")).toBe(false);
    expect(isLeaseOwner("tab2")).toBe(true);
  });

  it("releases lease cleanly", () => {
    acquireLease("tab1");
    releaseLease("tab1");

    expect(getLeaseInfo()).toBeNull();
    expect(acquireLease("tab2")).toBe(true);
  });
});
