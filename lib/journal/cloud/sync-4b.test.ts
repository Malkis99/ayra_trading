import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository, resetStampClockForTests } from "../repository";
import { CloudJournalRepository } from "./cloud-repository";
import { FakeRemote, trade } from "./testing/fake-remote";
import { markInitialSyncDone } from "./sync-state";
import { SyncOutbox } from "./outbox";
import { planMerge, readBase, readConflicts } from "./sync-merge";
import type { CloudEntry } from "./records";

const USER = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b1";

/* ---------------------------------------------------------------- two devices in one test */
// Each "device" has its own browser storage; the cloud (FakeRemote) is shared.
const storages = new Map<string, Record<string, string>>();
let current = "A";
function dumpStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k)!;
  }
  return out;
}
function onDevice(name: string) {
  storages.set(current, dumpStorage());
  localStorage.clear();
  for (const [k, v] of Object.entries(storages.get(name) ?? {})) localStorage.setItem(k, v);
  current = name;
}

let cloud: FakeRemote;
let devA: CloudJournalRepository;
let devB: CloudJournalRepository;
const sync = async (repo: CloudJournalRepository) => {
  await repo.syncNow();
  await repo.whenIdle();
};
const entry = (id: string, rec: Record<string, unknown>): CloudEntry => ({ table: "journal_trades", id, record: { id, ...rec } });

beforeEach(() => {
  localStorage.clear();
  storages.clear();
  current = "A";
  resetStampClockForTests();
  AppStorage.setUserId(USER);
  cloud = new FakeRemote(USER);
  devA = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, undefined, "tab_A");
  devB = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, undefined, "tab_B");
  for (const d of ["A", "B"]) {
    onDevice(d);
    markInitialSyncDone(USER);
  }
  onDevice("A");
});
afterEach(() => {
  devA.dispose();
  devB.dispose();
  vi.useRealTimers();
  AppStorage.setUserId(null);
});

describe("T7b-4b merge rule (base version, not clocks)", () => {
  const v = (updatedAt: string, deletedAt?: string) => ({ updatedAt, ...(deletedAt ? { deletedAt } : {}) });
  const base = { "journal_trades:t": "2026-10-18T10:00:00.000Z|" };
  const local = (rec: Record<string, unknown>) => new Map([["journal_trades:t", entry("t", rec)]]);

  it("only the cloud changed -> take it", () => {
    const plan = planMerge({ local: local(v("2026-10-18T10:00:00.000Z")), base, pending: new Set(), conflicts: new Set(), remote: [entry("t", v("2026-10-18T11:00:00.000Z"))] });
    expect(plan.take.map((e) => e.id)).toEqual(["t"]);
    expect(plan.conflicts).toEqual([]);
  });

  it("only this device changed (cloud = base) -> keep ours", () => {
    const plan = planMerge({ local: local(v("2026-10-18T12:00:00.000Z")), base, pending: new Set(["journal_trades:t"]), conflicts: new Set(), remote: [entry("t", v("2026-10-18T10:00:00.000Z"))] });
    expect(plan.take).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("both changed to the same version -> nothing to do, the queue entry settles", () => {
    const same = v("2026-10-18T12:00:00.000Z");
    const plan = planMerge({ local: local(same), base, pending: new Set(["journal_trades:t"]), conflicts: new Set(), remote: [entry("t", same)] });
    expect(plan.settled).toEqual(["journal_trades:t"]);
    expect(plan.conflicts).toEqual([]);
  });

  it("both changed differently -> conflict, whatever the clocks say (cloud 'older' or 'newer')", () => {
    for (const cloudTime of ["2026-10-18T09:00:00.000Z", "2026-10-18T13:00:00.000Z"]) {
      const plan = planMerge({ local: local(v("2026-10-18T12:00:00.000Z")), base, pending: new Set(["journal_trades:t"]), conflicts: new Set(), remote: [entry("t", v(cloudTime))] });
      expect(plan.conflicts.map((e) => e.id)).toEqual(["t"]);
      expect(plan.take).toEqual([]);
    }
  });

  it("deleted in the cloud, edited here -> conflict (a tombstone is a version too)", () => {
    const plan = planMerge({
      local: local(v("2026-10-18T12:00:00.000Z")),
      base,
      pending: new Set(["journal_trades:t"]),
      conflicts: new Set(),
      remote: [entry("t", v("2026-10-18T11:00:00.000Z", "2026-10-18T11:00:00.000Z"))],
    });
    expect(plan.conflicts.map((e) => e.record.deletedAt)).toEqual(["2026-10-18T11:00:00.000Z"]);
  });

  it("the echo of our own send changes nothing; a record already in conflict only updates its cloud copy", () => {
    expect(planMerge({ local: local(v("x")), base, pending: new Set(), conflicts: new Set(), remote: [entry("t", v("2026-10-18T10:00:00.000Z"))] })).toMatchObject({ take: [], conflicts: [] });
    const plan = planMerge({ local: local(v("x")), base, pending: new Set(["journal_trades:t"]), conflicts: new Set(["journal_trades:t"]), remote: [entry("t", v("2026-10-18T14:00:00.000Z"))] });
    expect(plan.conflictUpdates.map((e) => e.id)).toEqual(["t"]);
  });
});

describe("T7b-4b two devices of one account", () => {
  it("an edit on A reaches B; B does not send it back", async () => {
    devA.saveTrade(trade("t1", { notes: "from A" }));
    await sync(devA);
    onDevice("B");
    const before = cloud.upserts.length;
    expect(await devB.pullFromCloud()).toEqual({ ok: true, applied: 1 });
    expect(devB.getTrade("t1")?.notes).toBe("from A");
    await sync(devB);
    expect(cloud.upserts.length).toBe(before);
  });

  it("deleted on A, edited on B while offline: conflict on B, both versions kept; 'take from cloud' deletes it on B (soft)", async () => {
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    onDevice("B");
    await sync(devB); // B has v1
    cloud.down = true;
    devB.saveTrade({ ...devB.getTrade("t1")!, notes: "edited on B" });
    await sync(devB); // offline: queued
    onDevice("A");
    cloud.down = false;
    devA.deleteTrade("t1");
    await sync(devA);
    expect(cloud.get("journal_trades", "t1")?.data.deletedAt).toBeTruthy();

    onDevice("B");
    await sync(devB);
    expect(devB.getTrade("t1")?.notes).toBe("edited on B"); // the device version is still shown
    expect(devB.listConflicts()).toMatchObject([{ id: "t1", cloud: { deletedAt: expect.any(String) } }]);
    expect(cloud.get("journal_trades", "t1")?.data.deletedAt).toBeTruthy(); // B's edit was not pushed over the deletion

    expect(devB.resolveConflict("journal_trades", "t1", "cloud")).toBe(true);
    await devB.whenIdle();
    expect(devB.getTrade("t1")).toBeNull();
    expect(devB.getAllRecords().trades.find((t) => t.id === "t1")?.deletedAt).toBeTruthy(); // tombstone, not erased
    expect(devB.listConflicts()).toEqual([]);
    expect(new SyncOutbox(USER).size()).toBe(0);
  });

  it("both edited the same trade: 'keep this device' wins in the cloud and reaches the other device", async () => {
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    onDevice("B");
    await sync(devB);
    cloud.down = true;
    devB.saveTrade({ ...devB.getTrade("t1")!, notes: "B" });
    onDevice("A");
    cloud.down = false;
    devA.saveTrade({ ...devA.getTrade("t1")!, notes: "A" });
    await sync(devA);

    onDevice("B");
    await sync(devB);
    expect(devB.listConflicts().map((c) => c.cloud.notes)).toEqual(["A"]);
    expect(devB.resolveConflict("journal_trades", "t1", "device")).toBe(true);
    await devB.whenIdle();
    await sync(devB);
    expect(cloud.get("journal_trades", "t1")?.data.notes).toBe("B");

    onDevice("A");
    await sync(devA);
    expect(devA.getTrade("t1")?.notes).toBe("B");
    expect(devA.listConflicts()).toEqual([]);
  });

  it("offline device: its own edits wait, others' edits arrive when it is back; nothing lost on either side", async () => {
    onDevice("B");
    cloud.down = true;
    devB.saveTrade(trade("tB", { notes: "made offline on B" }));
    await sync(devB);
    onDevice("A");
    cloud.down = false;
    devA.saveTrade(trade("tA"));
    await sync(devA);
    onDevice("B");
    await sync(devB);
    expect(devB.getTrade("tA")).not.toBeNull();
    expect(cloud.get("journal_trades", "tB")?.data.notes).toBe("made offline on B");
    onDevice("A");
    await sync(devA);
    expect(devA.getTrade("tB")?.notes).toBe("made offline on B");
  });

  it("clock of B is an hour behind: B's later edit still wins in the cloud (no silent loss)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-18T12:00:00.000Z") });
    devA.saveTrade(trade("t1", { notes: "A at 12:00" }));
    await sync(devA);
    onDevice("B");
    await sync(devB);
    resetStampClockForTests();
    vi.setSystemTime(new Date("2026-10-18T11:00:00.000Z")); // B's clock
    devB.saveTrade({ ...devB.getTrade("t1")!, notes: "B, later, clock behind" });
    expect(Date.parse(devB.getTrade("t1")!.updatedAt)).toBeGreaterThan(Date.parse("2026-10-18T12:00:00.000Z"));
    await sync(devB);
    expect(cloud.get("journal_trades", "t1")?.data.notes).toBe("B, later, clock behind");
    expect(devB.listConflicts()).toEqual([]);
  });

  it("clock of B a day AHEAD: the server refuses B's time (record not created), other devices keep updating it; once B's clock is right its edit gets a sane time and goes", async () => {
    const SERVER = Date.parse("2026-10-18T12:00:00.000Z");
    let serverNow = SERVER;
    cloud.serverClock = () => serverNow;
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(SERVER) });
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    onDevice("B");
    await sync(devB);

    resetStampClockForTests();
    vi.setSystemTime(new Date(SERVER + 24 * 3600 * 1000)); // B's clock: tomorrow
    devB.saveTrade(trade("tB", { notes: "B new trade, clock ahead" }));
    await sync(devB);
    expect(cloud.get("journal_trades", "tB")).toBeUndefined(); // never stored with a time from the future
    expect(devB.getCloudStatus()).toMatchObject({ state: "error", lastError: "deviceClockAhead", pending: 1 });
    expect(devB.getTrade("tB")).not.toBeNull(); // nothing lost on the device

    // A (right clock) keeps updating the shared record
    onDevice("A");
    vi.setSystemTime(new Date(SERVER + 60_000));
    serverNow = SERVER + 60_000;
    devA.saveTrade({ ...devA.getTrade("t1")!, notes: "v2 from A" });
    await sync(devA);
    expect(cloud.get("journal_trades", "t1")?.data.notes).toBe("v2 from A");

    // B's clock is corrected: its edit is sent with a sane time
    onDevice("B");
    resetStampClockForTests();
    vi.setSystemTime(new Date(SERVER + 120_000));
    serverNow = SERVER + 120_000;
    await sync(devB);
    const stored = cloud.get("journal_trades", "tB")!;
    expect(stored.data.notes).toBe("B new trade, clock ahead");
    expect(Date.parse(String(stored.data.updatedAt))).toBeLessThanOrEqual(serverNow + 5 * 60 * 1000);
    expect(devB.getCloudStatus().state).toBe("synced");

    // and A can update B's record afterwards (not blocked by a time from the future)
    onDevice("A");
    await sync(devA);
    vi.setSystemTime(new Date(SERVER + 180_000));
    serverNow = SERVER + 180_000;
    devA.saveTrade({ ...devA.getTrade("tB")!, notes: "A edits B's trade" });
    await sync(devA);
    expect(cloud.get("journal_trades", "tB")?.data.notes).toBe("A edits B's trade");
  });

  it("a version the server refuses is re-stamped and sent again when the cloud still holds the version we started from", async () => {
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    onDevice("B");
    await sync(devB);
    // B edits with a time older than the cloud copy (as if the local fix did not apply)
    const stale = { ...devB.getAllRecords().trades.find((t) => t.id === "t1")!, notes: "B edit", updatedAt: "2026-01-01T00:00:00.000Z" };
    new LocalStorageJournalRepository().replaceAllRecords({ ...devB.getAllRecords(), trades: [stale] });
    new SyncOutbox(USER).enqueue([{ table: "journal_trades", id: "t1", version: "stale" }], 0, 0);
    await sync(devB);
    await sync(devB);
    expect(cloud.get("journal_trades", "t1")?.data.notes).toBe("B edit");
    expect(devB.listConflicts()).toEqual([]);
  });

  it("the cloud changes between pull and push: the refused send becomes a conflict, not a silent success", async () => {
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    onDevice("B");
    await sync(devB);
    devB.saveTrade({ ...devB.getTrade("t1")!, notes: "B" });
    // another device writes right after this pull read the trades and before the push
    cloud.afterFetch = (table) => {
      if (table !== "journal_settings") return;
      cloud.put("journal_trades", "t1", { ...trade("t1", { notes: "A, meanwhile" }), updatedAt: "2099-01-01T00:00:00.000Z" });
      cloud.afterFetch = undefined;
    };
    await sync(devB);
    expect(devB.getTrade("t1")?.notes).toBe("B");
    expect(devB.listConflicts().map((c) => c.cloud.notes)).toEqual(["A, meanwhile"]);
  });

  it("base versions are tracked per record after pulls and sends", async () => {
    devA.saveTrade(trade("t1"));
    await sync(devA);
    expect(readBase(USER)["journal_trades:t1"]).toBe(`${devA.getTrade("t1")!.updatedAt}|`);
  });
});

describe("T7b-4b account isolation", () => {
  it("the account switches in the middle of a pull: nothing is written into either account, the cursor does not move", async () => {
    cloud.put("journal_trades", "t1", { ...trade("t1", { updatedAt: "2026-10-18T10:00:00.000Z" }) });
    cloud.afterFetch = (table) => {
      if (table === "journal_trades") {
        AppStorage.setUserId(OTHER);
        cloud.session = OTHER;
      }
    };
    expect(await devA.pullFromCloud()).toEqual({ ok: false, applied: 0 });
    cloud.afterFetch = undefined;
    expect(new LocalStorageJournalRepository(undefined, OTHER).getAllRecords().trades).toEqual([]);
    expect(new LocalStorageJournalRepository(undefined, USER).getAllRecords().trades).toEqual([]);
    expect(localStorage.getItem(`ayra:${USER}:ayra_journal_cloud_cursor`)).toBeNull();
  });

  it("the header badge and the sign-out warning only count this account: A's waiting changes and conflicts are not shown for B", async () => {
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    cloud.put("journal_trades", "t1", { ...trade("t1", { notes: "elsewhere" }), updatedAt: "2099-01-01T00:00:00.000Z" });
    devA.saveTrade({ ...devA.getTrade("t1")!, notes: "here" });
    await sync(devA); // A: one conflict
    cloud.down = true;
    devA.saveTrade(trade("t2"));
    await sync(devA); // A: one change waiting
    expect(devA.getCloudStatus()).toMatchObject({ pending: 1, conflicts: 1 });

    cloud.down = false;
    AppStorage.setUserId(OTHER);
    cloud.session = OTHER;
    markInitialSyncDone(OTHER);
    await sync(devA);
    expect(devA.getCloudStatus()).toMatchObject({ pending: 0, conflicts: 0 });
    expect(devA.listConflicts()).toEqual([]);
  });

  it("conflicts, base versions and cursor are stored per account; another account never sees them", async () => {
    devA.saveTrade(trade("t1", { notes: "v1" }));
    await sync(devA);
    cloud.put("journal_trades", "t1", { ...trade("t1", { notes: "elsewhere" }), updatedAt: "2099-01-01T00:00:00.000Z" });
    devA.saveTrade({ ...devA.getTrade("t1")!, notes: "here" });
    await sync(devA);
    expect(Object.keys(readConflicts(USER))).toEqual(["journal_trades:t1"]);

    AppStorage.setUserId(OTHER);
    cloud.session = OTHER;
    markInitialSyncDone(OTHER);
    expect(devA.listConflicts()).toEqual([]);
    expect(readConflicts(OTHER)).toEqual({});
    expect(readBase(OTHER)).toEqual({});
    await sync(devA);
    expect(devA.getTrades()).toEqual([]); // OTHER's cloud is empty; USER's trade is not here
    expect(cloud.get("journal_trades", "t1", OTHER)).toBeUndefined();
  });
});

describe("journal settings through the cloud (setup plan PR 1)", () => {
  it("set on A → arrive on B; changed on both → the newer wins, no conflict dialog", async () => {
    onDevice("A");
    devA.setPreferences({ defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "london" });
    await sync(devA);
    onDevice("B");
    await sync(devB);
    expect(devB.getPreferences()).toEqual({ defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "london" });

    // both change before syncing; B changes later, so B is newer
    onDevice("A");
    devA.setPreferences({ defaultUnit: "percent" });
    await new Promise((r) => setTimeout(r, 5));
    onDevice("B");
    devB.setPreferences({ defaultUnit: "R", defaultSession: "newyork" });
    onDevice("A");
    await sync(devA);
    onDevice("B");
    await sync(devB);
    onDevice("A");
    await sync(devA);
    expect(devA.getPreferences()).toEqual({ defaultUnit: "R", defaultSession: "newyork" });
    onDevice("B");
    expect(devB.getPreferences()).toEqual({ defaultUnit: "R", defaultSession: "newyork" });
    expect(Object.keys(readConflicts(USER))).toEqual([]);
    onDevice("A");
    expect(Object.keys(readConflicts(USER))).toEqual([]);
  });
});
