import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository } from "../repository";
import { addImportBatch, listImportBatches, markImportBatchUndone } from "../import/batches";
import type { Trade } from "../types";
import { CloudJournalRepository } from "./cloud-repository";
import type { JournalCloudRemote } from "./remote";
import type { JournalCloudReadRow, JournalCloudTable, JournalCloudWriteRow } from "./records";
import { JOURNAL_CLOUD_MAX_RECORD_BYTES } from "./config";
import { markInitialSyncDone } from "./sync-state";
import { SyncOutbox } from "./outbox";
import { spaceTabChannel } from "@/lib/auth/space-channel";

const USER = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b1";

/** In-memory stand-in for the 0004 tables: same rules as the server (own rows, last-write-wins, server updated_at). */
class FakeRemote implements JournalCloudRemote {
  session: string | null = USER;
  enabled = true;
  down = false;
  flagCalls = 0;
  upserts: { table: JournalCloudTable; rows: JournalCloudWriteRow[] }[] = [];
  rows = new Map<string, JournalCloudReadRow & { table: JournalCloudTable }>();
  private clock = Date.parse("2026-10-18T12:00:00Z");

  private net() {
    if (this.down) throw new Error("Failed to fetch");
  }
  async currentUserId() {
    return this.session;
  }
  async isSyncEnabled() {
    this.flagCalls++;
    this.net();
    return this.enabled;
  }
  async upsert(table: JournalCloudTable, rows: JournalCloudWriteRow[]) {
    this.net();
    this.upserts.push({ table, rows });
    for (const r of rows) this.put(table, r.id, r.data);
  }
  /** Server-side write (another device): newer client time wins, server stamps updated_at. */
  put(table: JournalCloudTable, id: string, data: Record<string, unknown>) {
    const key = `${table}:${id}`;
    const old = this.rows.get(key);
    if (old && Date.parse(String(old.data.updatedAt)) > Date.parse(String(data.updatedAt))) return;
    this.clock += 1000;
    this.rows.set(key, { table, id, data: structuredClone(data), updated_at: new Date(this.clock).toISOString() });
  }
  async fetchSince(table: JournalCloudTable, since: string | null) {
    this.net();
    return [...this.rows.values()]
      .filter((r) => r.table === table && (!since || r.updated_at > since))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }
  sent(table: JournalCloudTable) {
    return this.upserts.filter((u) => u.table === table).flatMap((u) => u.rows);
  }
}

function trade(id: string, extra: Partial<Trade> = {}): Trade {
  return {
    id,
    accountId: "acc_1",
    instrument: "EURUSD",
    direction: "long",
    status: "closed",
    openedAt: "2026-10-17T09:00:00.000Z",
    result: "win",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-10-17T09:00:00.000Z",
    updatedAt: "2026-10-17T09:00:00.000Z",
    schemaVersion: 6,
    ...extra,
  };
}

/** Sends what is queued now (no waiting for the 1 s debounce) and waits for every request. */
const settle = async () => {
  await repo.syncNow();
  await repo.whenIdle();
};

let remote: FakeRemote;
let local: LocalStorageJournalRepository;
let repo: CloudJournalRepository;

beforeEach(() => {
  localStorage.clear();
  AppStorage.setUserId(USER);
  remote = new FakeRemote();
  local = new LocalStorageJournalRepository();
  repo = new CloudJournalRepository(local, remote, undefined, "tab_a");
  markInitialSyncDone(USER);
});
afterEach(() => {
  repo.dispose();
  AppStorage.setUserId(null);
  vi.restoreAllMocks();
});

describe("T7b-3 cloud journal repository", () => {
  it("same interface: reads and writes are local and synchronous", () => {
    repo.saveTrade(trade("tr_1"));
    expect(repo.getTrades().map((t) => t.id)).toEqual(["tr_1"]);
    expect(local.getTrade("tr_1")?.instrument).toBe("EURUSD");
  });

  it("flag on: a saved trade goes to the cloud as id + data + device_id only, schemaVersion inside", async () => {
    repo.saveTrade(trade("tr_1"));
    await settle();
    const [row] = remote.sent("journal_trades");
    expect(Object.keys(row).sort()).toEqual(["data", "device_id", "id"]);
    expect(row.id).toBe("tr_1");
    expect(row.data.schemaVersion).toBe(6);
    expect(row.data.instrument).toBe("EURUSD");
    expect(row.device_id).toMatch(/^dev_/);
    expect(repo.getCloudStatus().state).toBe("synced");
  });

  it("records of other kinds get schemaVersion in the cloud copy; plans are keyed by date", async () => {
    repo.saveNote({ id: "n_1", body: "hi", tags: [], pinned: false, createdAt: "2026-10-17T09:00:00Z", updatedAt: "2026-10-17T09:00:00Z" });
    repo.saveTradingPlan({ date: "2026-10-17", bias: [], levels: [], events: [], checklist: [], createdAt: "x", updatedAt: "x" });
    repo.setPrimaryPropAccountId("acc_1");
    await settle();
    expect(remote.sent("journal_notes")[0].data.schemaVersion).toBe(6);
    expect(remote.sent("journal_day_plans")[0].id).toBe("2026-10-17");
    expect(remote.sent("journal_settings")[0]).toMatchObject({ id: "journal", data: { primaryPropAccountId: "acc_1" } });
  });

  it("XP, coins, achievements and quests never go into a cloud record", async () => {
    repo.saveTrade({ ...trade("tr_1"), xp: 500, coins: 10, achievements: ["a"], quests: ["q"] } as unknown as Trade);
    await settle();
    const data = remote.sent("journal_trades")[0].data;
    for (const k of ["xp", "coins", "achievements", "quests"]) expect(data).not.toHaveProperty(k);
  });

  it("soft delete: a tombstone with deletedAt is sent, nothing is hard-deleted", async () => {
    repo.saveTrade(trade("tr_1"));
    await settle();
    repo.deleteTrade("tr_1");
    await settle();
    const rows = remote.sent("journal_trades");
    expect(rows).toHaveLength(2);
    expect(rows[1].data.deletedAt).toBeTruthy();
    expect(repo.getTrades()).toEqual([]);
    expect(remote.rows.get("journal_trades:tr_1")?.data.deletedAt).toBeTruthy();
  });

  it("only changed records are sent", async () => {
    repo.saveTrade(trade("tr_1"));
    repo.saveTrade(trade("tr_2"));
    await settle();
    remote.upserts = [];
    repo.saveTrade(trade("tr_2", { notes: "edited" }));
    await settle();
    expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_2"]);
  });

  it("flag off: nothing is sent or read, the answer is cached, the journal works as before", async () => {
    remote.enabled = false;
    repo.saveTrade(trade("tr_1"));
    await settle();
    repo.saveTrade(trade("tr_2"));
    await settle();
    expect(await repo.pullFromCloud()).toEqual({ ok: false, applied: 0 });
    expect(remote.upserts).toEqual([]);
    expect(remote.flagCalls).toBe(1);
    expect(repo.getTrades()).toHaveLength(2);
    expect(repo.getCloudStatus().state).toBe("local");
  });

  it("guest, or a session of another user: the cloud is not touched", async () => {
    AppStorage.setUserId(null);
    repo.saveTrade(trade("tr_guest"));
    await settle();
    AppStorage.setUserId(USER);
    remote.session = OTHER;
    repo.saveTrade(trade("tr_1"));
    await settle();
    expect(remote.upserts).toEqual([]);
    expect(remote.flagCalls).toBe(0);
  });

  it("network down: no exception, local data kept, status offline; the queued record is retried when the network is back", async () => {
    repo.saveTrade(trade("tr_0"));
    await settle(); // flag known to be on
    remote.down = true;
    expect(() => repo.saveTrade(trade("tr_1"))).not.toThrow();
    await settle();
    expect(repo.getTrade("tr_1")).not.toBeNull();
    expect(repo.getCloudStatus()).toMatchObject({ state: "offline", pending: 1 });

    remote.down = false;
    await settle();
    expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_0", "tr_1"]);
    expect(repo.getCloudStatus()).toMatchObject({ state: "synced", pending: 0 });
  });

  it("flag check not reachable: nothing sent, the record waits in the queue", async () => {
    remote.down = true;
    repo.saveTrade(trade("tr_1"));
    await settle();
    expect(remote.upserts).toEqual([]);
    expect(new SyncOutbox(USER).size()).toBe(1);
    remote.down = false;
    await settle();
    expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1"]);
  });

  it("server error on upsert: local data kept, nothing thrown, record stays queued", async () => {
    repo.saveTrade(trade("tr_0"));
    await settle();
    remote.upsert = async () => {
      throw new Error("internal error");
    };
    repo.saveTrade(trade("tr_1"));
    await settle();
    expect(repo.getTrade("tr_1")).not.toBeNull();
    expect(repo.getCloudStatus()).toMatchObject({ state: "error", lastError: "internal error", pending: 1 });
  });

  it("server refuses because sync was turned off (RLS 42501): sending stops, queue kept, journal stays local", async () => {
    repo.saveTrade(trade("tr_0"));
    await settle();
    remote.upsert = async () => {
      throw Object.assign(new Error("new row violates row-level security policy"), { code: "42501" });
    };
    repo.saveTrade(trade("tr_1"));
    await settle();
    expect(repo.getCloudStatus().state).toBe("local");
    expect(new SyncOutbox(USER).size()).toBe(1);
    repo.saveTrade(trade("tr_2")); // flag known off: not even queued
    expect(new SyncOutbox(USER).size()).toBe(1);
  });

  it("a record over the size limit stays local and is reported, the rest is sent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    repo.saveTrade(trade("tr_big", { notes: "x".repeat(JOURNAL_CLOUD_MAX_RECORD_BYTES) }));
    repo.saveTrade(trade("tr_ok"));
    await settle();
    expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_ok"]);
    expect(repo.getTrade("tr_big")).not.toBeNull();
    expect(repo.getCloudStatus().state).toBe("synced");
  });

  it("the size check uses the record that is sent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    repo.saveTrade(trade("tr_big", { notes: "x".repeat(JOURNAL_CLOUD_MAX_RECORD_BYTES) }));
    await settle();
    expect(repo.getCloudStatus().blocked).toEqual([{ table: "journal_trades", id: "tr_big", blocked: "tooLarge" }]);
    // not retried while unchanged
    await settle();
    expect(remote.upserts).toEqual([]);
  });

  describe("pull and version conflicts (last-write-wins)", () => {
    it("a newer cloud version replaces the local one and the screen is told", async () => {
      repo.saveTrade(trade("tr_1", { notes: "old" }));
      await settle();
      remote.put("journal_trades", "tr_1", { ...trade("tr_1", { notes: "from phone" }), updatedAt: "2099-01-01T00:00:00.000Z" });
      const listener = vi.fn();
      const unsubscribe = repo.subscribe(listener);
      await settle();
      expect(repo.getTrade("tr_1")?.notes).toBe("from phone");
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("an older cloud version does not overwrite a newer local change", async () => {
      remote.put("journal_trades", "tr_1", { ...trade("tr_1", { notes: "cloud, old" }), updatedAt: "2026-01-01T00:00:00.000Z" });
      local.saveTrade(trade("tr_1", { notes: "local, newer" })); // stamped now
      expect(await repo.pullFromCloud()).toEqual({ ok: true, applied: 0 });
      expect(repo.getTrade("tr_1")?.notes).toBe("local, newer");
    });

    it("the server keeps the newer version when an older one is pushed", async () => {
      remote.put("journal_trades", "tr_1", { ...trade("tr_1", { notes: "phone" }), updatedAt: "2099-01-01T00:00:00.000Z" });
      repo.saveTrade(trade("tr_1", { notes: "laptop" }));
      await settle();
      expect(remote.rows.get("journal_trades:tr_1")?.data.notes).toBe("phone");
    });

    it("records arriving from the cloud: new ones added, tombstones hidden, written by a newer app version skipped", async () => {
      remote.put("journal_trades", "tr_new", { ...trade("tr_new"), updatedAt: "2026-10-18T10:00:00.000Z" });
      remote.put("journal_trades", "tr_gone", { ...trade("tr_gone"), updatedAt: "2026-10-18T10:00:00.000Z", deletedAt: "2026-10-18T10:00:00.000Z" });
      remote.put("journal_trades", "tr_future_app", { ...trade("tr_future_app"), schemaVersion: 99 });
      remote.put("journal_notes", "n_1", { id: "n_1", body: "b", tags: [], pinned: false, createdAt: "x", updatedAt: "2026-10-18T10:00:00.000Z", schemaVersion: 6 });
      const res = await repo.pullFromCloud();
      expect(res).toEqual({ ok: true, applied: 3 });
      expect(repo.getTrades().map((t) => t.id)).toEqual(["tr_new"]);
      expect(repo.getAllRecords().trades.find((t) => t.id === "tr_gone")?.deletedAt).toBeTruthy();
      expect(repo.getNote("n_1")).not.toHaveProperty("schemaVersion");
      // a merged record is not sent back
      await settle();
      expect(remote.upserts).toEqual([]);
    });

    it("the next pull asks only for changes since the last one", async () => {
      remote.put("journal_trades", "tr_1", { ...trade("tr_1"), updatedAt: "2026-10-18T10:00:00.000Z" });
      await repo.pullFromCloud();
      const spy = vi.spyOn(remote, "fetchSince");
      await repo.pullFromCloud();
      const since = spy.mock.calls.find(([t]) => t === "journal_trades")?.[1];
      expect(since).toBeTruthy();
      expect(spy.mock.calls.find(([t]) => t === "journal_notes")?.[1]).toBeNull();
    });

    it("account switched while the pull was running: nothing is written into the other space", async () => {
      remote.put("journal_trades", "tr_1", { ...trade("tr_1"), updatedAt: "2026-10-18T10:00:00.000Z" });
      const original = remote.fetchSince.bind(remote);
      remote.fetchSince = async (t, s) => {
        AppStorage.setUserId(OTHER);
        return original(t, s);
      };
      expect(await repo.pullFromCloud()).toEqual({ ok: false, applied: 0 });
      expect(local.getTrades()).toEqual([]); // OTHER's journal
      AppStorage.setUserId(USER);
      expect(local.getTrades()).toEqual([]);
    });
  });

  it("import history is mirrored too (undo = tombstone)", async () => {
    const unsubscribe = repo.subscribe(() => {});
    await settle();
    addImportBatch({ id: "imp_1", createdAt: "2026-10-18T09:00:00.000Z", formatId: "ayra", fileName: "f.json", accountId: "acc_1", tradeCount: 1 });
    await settle();
    markImportBatchUndone("imp_1", "2026-10-18T09:05:00.000Z");
    await settle();
    const rows = remote.sent("journal_import_batches");
    expect(rows.map((r) => r.data.undoneAt ?? null)).toEqual([null, "2026-10-18T09:05:00.000Z"]);
    expect(listImportBatches()).toHaveLength(1);
    unsubscribe();
  });

  describe("T7b-4a outbox", () => {
    it("before the first sync nothing is sent: changes wait in the queue, then go out", async () => {
      localStorage.removeItem(`ayra:${USER}:ayra_sync_state`);
      repo.saveTrade(trade("tr_1"));
      repo.saveNote({ id: "n_1", body: "x", tags: [], pinned: false, createdAt: "x", updatedAt: "x" });
      await settle();
      expect(remote.upserts).toEqual([]);
      expect(repo.getCloudStatus()).toMatchObject({ state: "waitingInitialSync", pending: 2 });
      expect(await repo.pullFromCloud()).toEqual({ ok: false, applied: 0 });

      markInitialSyncDone(USER);
      await settle();
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1"]);
      expect(remote.sent("journal_notes").map((r) => r.id)).toEqual(["n_1"]);
      expect(repo.getCloudStatus().pending).toBe(0);
    });

    it("several edits of one record = one queue entry and one row with the newest version", async () => {
      repo.saveTrade(trade("tr_1", { notes: "a" }));
      repo.saveTrade(trade("tr_1", { notes: "b" }));
      repo.saveTrade(trade("tr_1", { notes: "c" }));
      expect(new SyncOutbox(USER).size()).toBe(1);
      await settle();
      const rows = remote.sent("journal_trades");
      expect(rows).toHaveLength(1);
      expect(rows[0].data.notes).toBe("c");
    });

    it("sends after the debounce pause on its own (no manual sync)", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        repo.saveTrade(trade("tr_1"));
        expect(remote.upserts).toEqual([]);
        await vi.advanceTimersByTimeAsync(1500);
        await repo.whenIdle();
        expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("the queue survives a reload (new repository, same device)", async () => {
      remote.down = true;
      repo.saveTrade(trade("tr_1"));
      await settle();
      repo.dispose();
      remote.down = false;
      repo = new CloudJournalRepository(new LocalStorageJournalRepository(), remote, undefined, "tab_b");
      await settle();
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1"]);
    });

    it("only the leader tab sends; when it is gone, another tab takes over", async () => {
      const repo2 = new CloudJournalRepository(new LocalStorageJournalRepository(), remote, undefined, "tab_2");
      try {
        repo.saveTrade(trade("tr_1"));
        await settle(); // tab_a becomes leader and sends
        repo2.saveTrade(trade("tr_2")); // written by the second tab into the same queue
        await repo2.syncNow();
        await repo2.whenIdle();
        expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1"]);
        repo.dispose(); // leader tab closed: lease released
        await repo2.syncNow();
        await repo2.whenIdle();
        expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1", "tr_2"]);
      } finally {
        repo2.dispose();
      }
    });

    it("sign-out: the queue gets sent by the space flush, then the engine stops", async () => {
      repo.saveTrade(trade("tr_1"));
      await repo.whenIdle();
      expect(remote.upserts).toEqual([]); // still in the debounce pause
      await AppStorage.flushSpace(`account:${USER}`);
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_1"]);
    });
  });

  describe("account isolation", () => {
    it("records of account A are never sent while account B is open; A's queue waits for A", async () => {
      remote.down = true;
      repo.saveTrade(trade("tr_a"));
      await settle();
      expect(new SyncOutbox(USER).size()).toBe(1);

      // B signs in on this device
      remote.down = false;
      AppStorage.setUserId(OTHER);
      remote.session = OTHER;
      markInitialSyncDone(OTHER);
      repo.saveTrade(trade("tr_b"));
      await settle();
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_b"]);
      expect(new SyncOutbox(USER).size()).toBe(1); // A's change kept for A
      expect(new SyncOutbox(OTHER).size()).toBe(0);

      // A comes back: only now A's record goes out
      AppStorage.setUserId(USER);
      remote.session = USER;
      await settle();
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_b", "tr_a"]);
    });

    it("account switched while a send was being prepared: nothing is sent", async () => {
      repo.saveTrade(trade("tr_a"));
      remote.isSyncEnabled = async () => {
        AppStorage.setUserId(OTHER); // another tab / sign-in switched the account meanwhile
        return true;
      };
      await settle();
      expect(remote.upserts).toEqual([]);
      AppStorage.setUserId(USER);
      expect(new SyncOutbox(USER).size()).toBe(1);
    });

    it("signing in to an account starts its engine: the queue of its last session goes out", async () => {
      remote.down = true;
      repo.saveTrade(trade("tr_a"));
      await settle();
      const unsubscribe = repo.subscribe(() => {});
      AppStorage.setUserId(null); // signed out
      remote.down = false;
      AppStorage.setUserId(USER); // signed in again
      spaceTabChannel.notifyLocal("guest", `account:${USER}`);
      await repo.whenIdle();
      await new Promise((r) => setTimeout(r, 1200)); // send pause
      await repo.whenIdle();
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_a"]);
      unsubscribe();
    });

    it("the engine reads only its own account's journal", async () => {
      AppStorage.setUserId(OTHER);
      new LocalStorageJournalRepository().saveTrade(trade("tr_other_space"));
      AppStorage.setUserId(USER);
      repo.saveTrade(trade("tr_a"));
      await settle();
      expect(remote.sent("journal_trades").map((r) => r.id)).toEqual(["tr_a"]);
    });
  });
});
