import { describe, expect, it, vi } from "vitest";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { PriorityQueue, emptyPriorityAccount, priorityValue, type PriorityAccount, type PriorityStore } from "./priority-queue";
import { WatchlistMetaError, type WatchlistMetaRemote } from "./watchlist-meta-sync";
import type { WatchlistMeta, WatchlistMetaWrite } from "./watchlist-meta";

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };
let operationSequence = 0;
function setup(shared?: ReturnType<typeof backend>) {
  const service = shared ?? backend();let record = emptyPriorityAccount(), active: string | null = "A", online = true;
  const store: PriorityStore = { read: async () => structuredClone(record), update: async (_uid, change) => { record = change(structuredClone(record));return structuredClone(record); } };
  const create = () => new PriorityQueue("A", service.remote, store, () => active, () => online, () => `00000000-0000-0000-0000-${String(++operationSequence).padStart(12, "0")}`);
  return { service, store, create, queue: create(), get record() { return record; }, set record(next: PriorityAccount) { record = next; }, set active(value: string | null) { active = value; }, set online(value: boolean) { online = value; } };
}
function backend() {
  let document: WatchlistMeta | null = null;
  const save = (data: WatchlistMetaWrite) => document = { ...structuredClone(data), updatedAt: "2026-11-21T10:00:00Z" };
  const remote = { currentUserId: vi.fn(async () => "A"), isSyncEnabled: vi.fn(async (): Promise<boolean> => true), read: vi.fn(async (): Promise<unknown> => document && structuredClone(document)),
    create: vi.fn(async (_uid: string, data: WatchlistMetaWrite): Promise<unknown> => document ? null : save(data)),
    replace: vi.fn(async (_uid: string, rev: number, data: WatchlistMetaWrite): Promise<unknown> => document?.revision === rev ? save(data) : null),
  } satisfies WatchlistMetaRemote;
  return { remote, save, get document() { return document; } };
}
describe("durable priority queue", () => {
  it("keeps an offline operation across controller reload, then removes only its confirmed receipt", async () => {
    const m = setup();await m.queue.run();m.online = false;
    await m.queue.enqueue("eurusd", true);
    expect(m.record.queue).toHaveLength(1);expect(priorityValue(m.record, "eurusd")).toBe(true);expect(m.service.remote.create).not.toHaveBeenCalled();
    m.queue.dispose();m.online = true;
    await m.create().run();expect(m.record.queue).toEqual([]);expect(m.service.document?.entries.eurusd.priority).toBe(true);
  });
  it("serializes true → false → true with exact per-entry revisions and stable operation IDs", async () => {
    const m = setup();await m.queue.run();m.online = false;
    await Promise.all([m.queue.enqueue("eurusd"), m.queue.enqueue("eurusd"), m.queue.enqueue("eurusd")]);
    expect(m.record.queue.map(q => q.operation.priority)).toEqual([true, false, true]);
    expect(m.record.queue.map(q => q.operation.expectedEntryRevision)).toEqual([0, 1, 2]);
    m.online = true;await m.queue.run();expect(m.record.queue).toEqual([]);expect(m.service.document?.entries.eurusd).toMatchObject({ priority: true, revision: 3 });
  });
  it("never says saved before an acknowledgement", async () => {
    const m = setup();await m.queue.run();const gate = deferred<unknown>();
    m.service.remote.create.mockImplementationOnce(() => gate.promise);
    const job = m.queue.enqueue("eurusd", true);await vi.waitFor(() => expect(m.service.remote.create).toHaveBeenCalled());
    expect(m.record.queue[0].status).toBe("pending");expect(m.record.raw).toBeNull();
    const proposal = m.service.remote.create.mock.calls[0][1];gate.resolve(m.service.save(proposal));await job;
    expect(m.record.queue).toEqual([]);
  });
  it("recovers a lost response without a duplicate write", async () => {
    const m = setup();await m.queue.run();m.service.remote.create.mockImplementationOnce(async (_uid, data) => { m.service.save(data);throw new TypeError("lost response"); });
    await m.queue.enqueue("eurusd");expect(m.record.queue).toEqual([]);expect(m.service.remote.create).toHaveBeenCalledTimes(1);
  });
  it("two devices merge independent instruments", async () => {
    const service = backend(), a = setup(service), b = setup(service);await Promise.all([a.queue.run(), b.queue.run()]);
    await Promise.all([a.queue.enqueue("eurusd", true), b.queue.enqueue("gold", true)]);
    expect(a.record.queue).toEqual([]);expect(b.record.queue).toEqual([]);expect(Object.keys(service.document!.entries).sort()).toEqual(["eurusd", "gold"]);
  });
  it("same-instrument conflict requires an explicit choice and does not block another instrument", async () => {
    const service = backend(), a = setup(service), b = setup(service);await Promise.all([a.queue.run(), b.queue.run()]);
    b.online = false;await b.queue.enqueue("eurusd", false);await b.queue.enqueue("gold", true);
    await a.queue.enqueue("eurusd", true);b.online = true;await b.queue.run();
    expect(b.record.queue).toHaveLength(1);expect(b.record.queue[0].status).toBe("conflict");expect(service.document?.entries.gold.priority).toBe(true);
    await b.queue.resolve("eurusd", true);expect(b.record.queue).toEqual([]);expect(service.document?.entries.eurusd.priority).toBe(false);
  });
  it("use-cloud discards only the explicitly resolved chain", async () => {
    const m = setup();await m.queue.run();m.online = false;await m.queue.enqueue("eurusd", true);
    m.record = { ...m.record, queue: m.record.queue.map(q => ({ ...q, status: "conflict" })) };
    m.online = true;await m.queue.resolve("eurusd", false);expect(m.record.queue).toEqual([]);expect(m.service.remote.create).not.toHaveBeenCalled();
  });
  it.each([null, "B"])("ignores acknowledgements after A → %s", async next => {
    const m = setup();await m.queue.run();const gate = deferred<unknown>();m.service.remote.create.mockImplementationOnce((_uid, data) => { m.service.save(data);return gate.promise; });
    const job = m.queue.enqueue("eurusd");await vi.waitFor(() => expect(m.service.remote.create).toHaveBeenCalled());m.active = next;gate.resolve(m.service.document);await job;
    expect(m.record.queue).toHaveLength(1);expect(m.record.raw).toBeNull();
  });
  it("invalidates A → B → A; returning controller safely confirms the persisted operation", async () => {
    const m = setup();await m.queue.run();const gate = deferred<unknown>();m.service.remote.create.mockImplementationOnce((_uid, data) => { m.service.save(data);return gate.promise; });
    const job = m.queue.enqueue("eurusd");await vi.waitFor(() => expect(m.service.remote.create).toHaveBeenCalled());
    spaceTabChannel.notifyLocal("account:A", "account:B");spaceTabChannel.notifyLocal("account:B", "account:A");gate.resolve(m.service.document);await job;
    expect(m.record.queue).toHaveLength(1);await m.create().run();expect(m.record.queue).toEqual([]);expect(m.service.remote.create).toHaveBeenCalledTimes(1);
  });
  it("cloud sync disabled never enqueues or writes", async () => {
    const m = setup();m.service.remote.isSyncEnabled.mockResolvedValue(false);await m.queue.run();await m.queue.enqueue("eurusd");expect(m.record.queue).toEqual([]);expect(m.service.remote.read).not.toHaveBeenCalled();expect(m.service.remote.create).not.toHaveBeenCalled();
  });
  it("persists an already accepted click only under A while storage opens during sign-out", async () => {
    const m = setup();await m.queue.run();const gate = deferred<void>(), update = m.store.update;
    m.store.update = async (id, change) => { await gate.promise;return update(id, change); };
    const job = m.queue.enqueue("eurusd");m.active = null;gate.resolve();await job;
    expect(m.record.queue[0].operation.userId).toBe("A");expect(m.service.remote.create).not.toHaveBeenCalled();
  });
  it("keeps refused operations as Error until an explicit retry, with a new operation ID", async () => {
    const m = setup();await m.queue.run();m.service.remote.create.mockRejectedValueOnce(new WatchlistMetaError("42501", "refused"));
    await m.queue.enqueue("eurusd");const id = m.record.queue[0].operation.operationId;expect(m.record.queue[0].status).toBe("error");
    await m.queue.run();expect(m.service.remote.create).toHaveBeenCalledTimes(1);
    await m.queue.resolve("eurusd", true);expect(m.record.queue).toEqual([]);expect(m.service.document?.entries.eurusd.operationId).not.toBe(id);
  });
  it("retains pending operations if the cloud flag is disabled later", async () => {
    const m = setup();await m.queue.run();m.online = false;await m.queue.enqueue("eurusd");m.service.remote.isSyncEnabled.mockResolvedValue(false);m.online = true;await m.queue.run();expect(m.record.queue).toHaveLength(1);expect(m.record.enabled).toBe(false);
  });
  it("preserves unknown fields/instruments and explicit false", async () => {
    const m = setup();m.service.save({ id: "watchlist_meta", version: 1, revision: 1, future: { opaque: [1, 2] }, entries: { newinstrument: { priority: false, revision: 1, operationId: "00000000-0000-0000-0000-000000009999", extra: true } } });
    await m.queue.run();await m.queue.enqueue("eurusd", false);expect(m.service.document).toMatchObject({ future: { opaque: [1, 2] }, entries: { newinstrument: { extra: true, priority: false }, eurusd: { priority: false } } });
  });
  it("keeps a newer raw contract without writes", async () => {
    const m = setup();const raw = { id: "watchlist_meta", version: 2, future: [1] };m.service.remote.read.mockResolvedValue(raw);await m.queue.run();await m.queue.enqueue("eurusd");expect(m.record.raw).toEqual(raw);expect(m.record.issue).toBe("unsupported");expect(m.service.remote.create).not.toHaveBeenCalled();
  });
  it("failed refresh retains confirmed values and queues; retry is event-driven, not a loop", async () => {
    const m = setup();await m.queue.run();await m.queue.enqueue("gold");m.service.remote.read.mockRejectedValue(new TypeError("offline"));await m.queue.run();
    const count = m.service.remote.read.mock.calls.length;await Promise.resolve();expect(m.service.remote.read).toHaveBeenCalledTimes(count);expect(priorityValue(m.record, "gold")).toBe(true);expect(m.record.issue).toBe("network");
  });
});
