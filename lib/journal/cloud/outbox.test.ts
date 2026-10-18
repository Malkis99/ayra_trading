import { describe, it, expect, beforeEach } from "vitest";
import { SyncOutbox, retryDelayMs } from "./outbox";
import { SyncLease } from "./lease";
import { SYNC_LEASE_TTL_MS, SYNC_RETRY_DELAYS_MS } from "./config";

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";
const t = (id: string, version = "v1") => ({ table: "journal_trades" as const, id, version });

beforeEach(() => localStorage.clear());

describe("T7b-4a retry pauses", () => {
  it("1 s, 5 s, 30 s, 2 min, then every 5 min (no spread at random = 0.5)", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => retryDelayMs(n, () => 0.5))).toEqual([1000, 5000, 30_000, 120_000, 300_000, 300_000, 300_000]);
  });

  it("spread stays within ±20%", () => {
    for (let i = 0; i < SYNC_RETRY_DELAYS_MS.length; i++) {
      const base = SYNC_RETRY_DELAYS_MS[i];
      expect(retryDelayMs(i + 1, () => 0)).toBe(base * 0.8);
      expect(retryDelayMs(i + 1, () => 0.999999)).toBeLessThanOrEqual(base * 1.2);
    }
  });
});

describe("T7b-4a outbox", () => {
  it("lives in the account space: queues of two accounts never mix", () => {
    new SyncOutbox(A).enqueue([t("tr_a")], 0, 0);
    new SyncOutbox(B).enqueue([t("tr_b")], 0, 0);
    expect(new SyncOutbox(A).list().map((e) => e.id)).toEqual(["tr_a"]);
    expect(new SyncOutbox(B).list().map((e) => e.id)).toEqual(["tr_b"]);
    expect(localStorage.getItem(`ayra:${A}:ayra_sync_outbox`)).toContain("tr_a");
    expect(localStorage.getItem(`ayra:${A}:ayra_sync_outbox`)).not.toContain("tr_b");
  });

  it("an edit while the old version was being sent keeps the entry (the newer version is still due)", () => {
    const box = new SyncOutbox(A);
    box.enqueue([t("tr_1", "v1")], 0, 0);
    box.enqueue([t("tr_1", "v2")], 1, 1); // edited again before the answer came
    box.markSent([t("tr_1", "v1")]);
    expect(box.list().map((e) => e.version)).toEqual(["v2"]);
    box.markSent([t("tr_1", "v2")]);
    expect(box.size()).toBe(0);
    expect(localStorage.getItem(`ayra:${A}:ayra_sync_outbox`)).toBeNull();
  });

  it("failures count attempts and push the next try back; a new edit makes it due again", () => {
    const box = new SyncOutbox(A);
    box.enqueue([t("tr_1")], 0, 0);
    box.markFailed([t("tr_1")], "offline", 1000, () => 0.5);
    box.markFailed([t("tr_1")], "offline", 2000, () => 0.5);
    expect(box.list()[0]).toMatchObject({ attempts: 2, nextAttemptAt: 7000, lastError: "offline" });
    expect(box.due(6999)).toEqual([]);
    expect(box.nextDueAt()).toBe(7000);
    box.enqueue([t("tr_1", "v2")], 3000, 3500);
    expect(box.list()[0]).toMatchObject({ attempts: 0, nextAttemptAt: 3500, version: "v2" });
  });

  it("a blocked record is not due until it changes", () => {
    const box = new SyncOutbox(A);
    box.enqueue([t("tr_big")], 0, 0);
    box.markBlocked(t("tr_big"), "tooLarge");
    expect(box.due(Infinity)).toEqual([]);
    expect(box.nextDueAt()).toBeNull();
    expect(box.blocked().map((e) => e.blocked)).toEqual(["tooLarge"]);
    box.enqueue([t("tr_big", "v2")], 1, 1);
    expect(box.due(Infinity).map((e) => e.id)).toEqual(["tr_big"]);
  });

  it("broken stored data gives an empty queue", () => {
    localStorage.setItem(`ayra:${A}:ayra_sync_outbox`, "{oops");
    expect(new SyncOutbox(A).list()).toEqual([]);
  });
});

describe("T7b-4a leader lease", () => {
  it("one tab per account leads; an expired lease is taken over; accounts do not compete", () => {
    let now = 0;
    const tab1 = new SyncLease(A, "tab_1", () => now);
    const tab2 = new SyncLease(A, "tab_2", () => now);
    expect(tab1.tryAcquire()).toBe(true);
    expect(tab2.tryAcquire()).toBe(false);
    expect(new SyncLease(B, "tab_2", () => now).tryAcquire()).toBe(true); // other account: own lease
    now += SYNC_LEASE_TTL_MS + 1; // tab_1 stopped renewing (closed)
    expect(tab2.tryAcquire()).toBe(true);
    expect(tab1.tryAcquire()).toBe(false);
    tab2.release();
    expect(tab1.tryAcquire()).toBe(true);
  });
});
