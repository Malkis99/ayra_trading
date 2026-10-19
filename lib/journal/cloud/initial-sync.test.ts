import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository, resetStampClockForTests } from "../repository";
import type { Trade } from "../types";
import { CloudJournalRepository } from "./cloud-repository";
import { FakeRemote, trade } from "./testing/fake-remote";
import { isInitialSyncDone } from "./sync-state";
import { SyncOutbox } from "./outbox";
import { readConflicts } from "./sync-merge";
import { JOURNAL_CLOUD_MAX_RECORD_BYTES } from "./config";

const USER = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b1";

// Each "device" has its own browser storage; the cloud (FakeRemote) is shared.
const storages = new Map<string, Record<string, string>>();
let current = "A";
function onDevice(name: string) {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)!] = localStorage.getItem(localStorage.key(i)!)!;
  storages.set(current, out);
  localStorage.clear();
  for (const [k, v] of Object.entries(storages.get(name) ?? {})) localStorage.setItem(k, v);
  current = name;
}

let cloud: FakeRemote;
let devA: CloudJournalRepository;
let devB: CloudJournalRepository;
const settle = async (repo: CloudJournalRepository) => {
  await repo.syncNow();
  await repo.whenIdle();
};
const cloudTrades = () => [...cloud.rows.values()].filter((r) => r.user === USER && r.table === "journal_trades");
/** Puts trades straight into this device's journal (as if made before cloud sync existed). */
const seedLocal = (trades: Trade[]) => {
  const repo = new LocalStorageJournalRepository();
  repo.saveAccount({ id: "acc_1", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-10-01T00:00:00.000Z" });
  repo.importTrades(trades);
};

beforeEach(() => {
  localStorage.clear();
  storages.clear();
  current = "A";
  resetStampClockForTests();
  AppStorage.setUserId(USER);
  cloud = new FakeRemote(USER);
  devA = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, undefined, "tab_A");
  devB = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, undefined, "tab_B");
});
afterEach(() => {
  devA.dispose();
  devB.dispose();
  vi.useRealTimers();
  AppStorage.setUserId(null);
});

describe("T7b-4d first upload (button)", () => {
  it("a device with local data waits for the button; the preview counts what goes up; the upload sends it once and finishes the first sync", async () => {
    seedLocal([trade("t1"), trade("t2"), trade("t3")]);
    devA.saveNote({ id: "n1", body: "note", tags: [], pinned: false, createdAt: "x", updatedAt: "x" });
    await settle(devA); // learns the flag; must NOT upload or download by itself
    expect(cloud.upserts).toEqual([]);
    expect(devA.getInitialSyncInfo()).toEqual({ needed: true, started: false });
    expect(devA.getCloudStatus().state).toBe("waitingInitialSync");

    const plan = await devA.analyzeInitialSync();
    expect(plan.toUpload.map((e) => e.table).sort()).toEqual(["journal_accounts", "journal_notes", "journal_trades", "journal_trades", "journal_trades"]);
    expect(plan).toMatchObject({ onlyCloud: [], differ: [], skipped: [], cloudLive: 0 });

    const progress: number[] = [];
    const res = await devA.runInitialSync({ onProgress: (d) => progress.push(d) });
    expect(res).toMatchObject({ uploaded: 5, total: 5, cancelled: false, conflicts: 0 });
    expect(progress.at(-1)).toBe(5);
    expect(cloudTrades().map((r) => r.id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(isInitialSyncDone(USER)).toBe(true);
    expect(devA.getInitialSyncInfo().needed).toBe(false);
    await devA.whenIdle();
    expect(new SyncOutbox(USER).size()).toBe(0); // what waited in the queue went up with the upload, not twice
  });

  it("cancel after a batch, then continue: nothing is uploaded twice, no copies", async () => {
    seedLocal(Array.from({ length: 250 }, (_, i) => trade(`t${String(i).padStart(3, "0")}`)));
    await settle(devA);
    let cancel = false;
    const first = await devA.runInitialSync({ onProgress: (d) => (cancel = d >= 100), shouldCancel: () => cancel });
    expect(first.cancelled).toBe(true);
    expect(isInitialSyncDone(USER)).toBe(false);
    expect(devA.getInitialSyncInfo()).toEqual({ needed: true, started: true });
    const afterCancel = cloudTrades().length;
    expect(afterCancel).toBeGreaterThan(0);
    expect(afterCancel).toBeLessThan(250);

    const second = await devA.runInitialSync();
    expect(second.cancelled).toBe(false);
    expect(cloudTrades()).toHaveLength(250);
    const sentIds = cloud.sent("journal_trades").map((r) => r.id);
    expect(new Set(sentIds).size).toBe(sentIds.length); // every trade sent exactly once
    expect(isInitialSyncDone(USER)).toBe(true);
  });

  it("records the server would refuse (too large, time from the future) are listed with the reason and do not block the rest", async () => {
    seedLocal([trade("ok1"), trade("big", { notes: "x".repeat(JOURNAL_CLOUD_MAX_RECORD_BYTES) })]);
    // a record stamped far in the future (device clock was wrong when it was saved)
    const repo = new LocalStorageJournalRepository();
    const all = repo.getAllRecords();
    repo.replaceAllRecords({ ...all, trades: [...all.trades, { ...trade("future"), updatedAt: "2099-01-01T00:00:00.000Z" }] });
    await settle(devA);
    const plan = await devA.analyzeInitialSync();
    expect(plan.skipped.map((s) => [s.id, s.reason]).sort()).toEqual([
      ["big", "tooLarge"],
      ["future", "fromFuture"],
    ]);
    const res = await devA.runInitialSync();
    expect(res.skipped).toHaveLength(2);
    expect(cloudTrades().map((r) => r.id)).toEqual(["ok1"]);
    expect(isInitialSyncDone(USER)).toBe(true);
    expect(devA.getTrade("big")).not.toBeNull(); // stays on the device
  });

  it("XP, coins, achievements and quests never go to the cloud", async () => {
    seedLocal([{ ...trade("t1"), xp: 50, coins: 5, achievements: ["a"], quests: ["q"] } as unknown as Trade]);
    await settle(devA);
    await devA.runInitialSync();
    const data = cloudTrades()[0].data;
    for (const k of ["xp", "coins", "achievements", "quests"]) expect(data).not.toHaveProperty(k);
  });
});

describe("T7b-4d empty device and second device", () => {
  async function aUploads(trades: Trade[]) {
    seedLocal(trades);
    await settle(devA);
    await devA.runInitialSync();
    await devA.whenIdle();
  }

  it("an empty device downloads the cloud journal by itself, with one notice", async () => {
    await aUploads([trade("t1"), trade("t2")]);
    onDevice("B");
    await devB.pullFromCloud();
    await devB.whenIdle();
    expect(devB.getTrades().map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(isInitialSyncDone(USER)).toBe(true);
    expect(devB.takeCloudDownloadNotice()).toBe(3); // 1 account + 2 trades
    expect(devB.takeCloudDownloadNotice()).toBeNull(); // once
    expect(devB.getInitialSyncInfo().needed).toBe(false);
  });

  it("a device with its own data does not download without the button", async () => {
    await aUploads([trade("t1")]);
    onDevice("B");
    seedLocal([trade("tB")]);
    await settle(devB);
    expect(devB.getTrade("t1")).toBeNull();
    expect(devB.getInitialSyncInfo().needed).toBe(true);
    expect(devB.takeCloudDownloadNotice()).toBeNull();
    expect(cloudTrades().map((r) => r.id)).toEqual(["t1"]); // B sent nothing either
  });

  it("second device with different data: only here / only in cloud / different; nothing in the cloud overwritten, differences become conflicts", async () => {
    await aUploads([trade("t1", { notes: "A" }), trade("t2")]);
    onDevice("B");
    seedLocal([trade("t1", { notes: "B" }), trade("t3")]);
    await settle(devB);
    const plan = await devB.analyzeInitialSync();
    expect(plan.toUpload.map((e) => e.id)).toEqual(["t3"]);
    expect(plan.onlyCloud.map((e) => e.id)).toEqual(["t2"]);
    expect(plan.differ.map((e) => e.id)).toEqual(["t1"]);
    expect(plan.same.map((e) => e.id)).toEqual(["acc_1"]);

    const res = await devB.runInitialSync();
    expect(res).toMatchObject({ uploaded: 1, downloaded: 1, conflicts: 1 });
    expect(devB.getTrade("t2")).not.toBeNull();
    expect(devB.getTrade("t1")?.notes).toBe("B"); // the device version stays until the user decides
    expect(cloud.get("journal_trades", "t1")?.data.notes).toBe("A"); // not overwritten
    expect(cloud.get("journal_trades", "t3")).toBeTruthy();
    expect(Object.keys(readConflicts(USER))).toEqual(["journal_trades:t1"]);
  });

  it("nothing on either side: the first sync is simply done, later edits sync as usual", async () => {
    await settle(devA);
    expect(isInitialSyncDone(USER)).toBe(true);
    expect(devA.getInitialSyncInfo().needed).toBe(false);
    devA.saveTrade(trade("t1"));
    await settle(devA);
    expect(cloudTrades().map((r) => r.id)).toEqual(["t1"]);
  });
});

describe("T7b-4d account isolation", () => {
  it("the account switches in the middle of the upload: it stops; nothing reaches the other account, here or in the cloud", async () => {
    seedLocal(Array.from({ length: 250 }, (_, i) => trade(`t${i}`)));
    await settle(devA);
    let switched = false;
    await expect(
      devA.runInitialSync({
        onProgress: (d) => {
          if (d >= 100 && !switched) {
            switched = true;
            AppStorage.setUserId(OTHER); // another tab / sign-in switched the account
            cloud.session = OTHER;
          }
        },
      })
    ).rejects.toThrow();
    expect([...cloud.rows.values()].filter((r) => r.user === OTHER)).toEqual([]);
    expect(new LocalStorageJournalRepository(undefined, OTHER).getAllRecords().trades).toEqual([]);
    expect(isInitialSyncDone(USER)).toBe(false);
    expect(isInitialSyncDone(OTHER)).toBe(false);
    expect(cloudTrades().length).toBeLessThan(250);
  });

  it("the upload only takes this account's journal on this device (a guest's or another account's data stays where it is)", async () => {
    AppStorage.setUserId(null);
    new LocalStorageJournalRepository().saveTrade(trade("guest_trade"));
    AppStorage.setUserId(OTHER);
    new LocalStorageJournalRepository().saveTrade(trade("other_trade"));
    AppStorage.setUserId(USER);
    seedLocal([trade("mine")]);
    await settle(devA);
    await devA.runInitialSync();
    expect(cloudTrades().map((r) => r.id)).toEqual(["mine"]);
  });
});
