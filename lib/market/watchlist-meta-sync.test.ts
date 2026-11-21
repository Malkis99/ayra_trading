import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { commitPriority, META_CAS_ATTEMPTS, META_HTTP_TIMEOUT_MS, SupabaseWatchlistMetaRemote, WatchlistMetaError, type WatchlistMetaRemote } from "./watchlist-meta-sync";
import { proposePriority, type PriorityOperation, type WatchlistMeta, type WatchlistMetaWrite } from "./watchlist-meta";

const operation = (n = 1, instrument: PriorityOperation["instrument"] = "eurusd"): PriorityOperation => ({ userId: "A", instrument, priority: true, expectedEntryRevision: 0, operationId: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}` });
function memory() {
  let document: WatchlistMeta | null = null;
  const save = (data: WatchlistMetaWrite) => document = { ...structuredClone(data), updatedAt: "2026-11-21T10:00:00Z" };
  const remote = {
    currentUserId: vi.fn(async () => "A"), isSyncEnabled: vi.fn(async (): Promise<boolean> => true),
    read: vi.fn(async () => document && structuredClone(document)),
    create: vi.fn(async (_uid: string, data: WatchlistMetaWrite) => document ? null : save(data)),
    replace: vi.fn(async (_uid: string, expected: number, data: WatchlistMetaWrite) => document?.revision === expected ? save(data) : null),
  } satisfies WatchlistMetaRemote;
  return { remote, save, get document() { return document; } };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };

describe("bounded metadata CAS", () => {
  it("concurrent first creation merges different instruments after the unique conflict", async () => {
    const m = memory();
    const result = await Promise.all([commitPriority(m.remote, () => "A", operation()), commitPriority(m.remote, () => "A", operation(2, "gbpusd"))]);
    expect(result.map(r => r.kind)).toEqual(["saved", "saved"]);
    expect(m.document?.revision).toBe(2);
    expect(Object.keys(m.document!.entries).sort()).toEqual(["eurusd", "gbpusd"]);
  });
  it("same-instrument competing changes report a conflict, without guessing intent", async () => {
    const m = memory();
    const result = await Promise.all([commitPriority(m.remote, () => "A", operation()), commitPriority(m.remote, () => "A", { ...operation(2), priority: false })]);
    expect(result.map(r => r.kind).sort()).toEqual(["conflict", "saved"]);
    expect(m.document?.revision).toBe(1);
  });
  it("a lost successful response is confirmed by readback and a retry is idempotent", async () => {
    const m = memory();
    m.remote.create.mockImplementationOnce(async (_uid, data) => { m.save(data); throw new TypeError("response lost"); });
    expect(await commitPriority(m.remote, () => "A", operation())).toMatchObject({ kind: "saved", replay: true });
    expect(await commitPriority(m.remote, () => "A", operation())).toMatchObject({ kind: "saved", replay: true });
    expect(m.remote.create).toHaveBeenCalledTimes(1);
    expect(m.document?.revision).toBe(1);
  });
  it("zero affected rows never means success and retries are bounded", async () => {
    const m = memory();
    m.remote.create.mockResolvedValue(null);
    expect(await commitPriority(m.remote, () => "A", operation())).toEqual({ kind: "pending", reason: "contended" });
    expect(m.remote.create).toHaveBeenCalledTimes(META_CAS_ATTEMPTS);
    expect(m.remote.read).toHaveBeenCalledTimes(META_CAS_ATTEMPTS);
  });
  it("offline remains pending, RLS denial is refused, cloud_sync=false sends no writes", async () => {
    const m = memory();
    m.remote.read.mockRejectedValueOnce(new TypeError("offline"));
    expect(await commitPriority(m.remote, () => "A", operation())).toEqual({ kind: "pending", reason: "network" });
    m.remote.create.mockRejectedValueOnce(new WatchlistMetaError("42501", "RLS"));
    expect(await commitPriority(m.remote, () => "A", operation())).toEqual({ kind: "refused", code: "42501" });
    m.remote.isSyncEnabled.mockResolvedValue(false);
    expect(await commitPriority(m.remote, () => "A", operation())).toEqual({ kind: "disabled" });
    expect(m.remote.create).toHaveBeenCalledTimes(1);
  });
  it("newer contract is read-only, without normalization or writes", async () => {
    const m = memory();
    m.remote.read.mockResolvedValueOnce({ id: "watchlist_meta", version: 2 } as unknown as WatchlistMeta);
    expect(await commitPriority(m.remote, () => "A", operation())).toEqual({ kind: "unsupported" });
    expect(m.remote.create).not.toHaveBeenCalled();
  });
  it.each(["B", null])("ignores a delayed read after changing account to %s", async next => {
    const m = memory(); let user: string | null = "A";
    const gate = deferred<WatchlistMeta | null>();
    m.remote.read.mockImplementationOnce(() => gate.promise);
    const pending = commitPriority(m.remote, () => user, operation());
    await vi.waitFor(() => expect(m.remote.read).toHaveBeenCalled());
    user = next; gate.resolve(null);
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(m.remote.create).not.toHaveBeenCalled();
  });
  it("invalidates even A → B → A and discards a delayed write acknowledgement", async () => {
    const m = memory(); const gate = deferred<WatchlistMeta | null>();
    m.remote.create.mockImplementationOnce((_uid, data) => { m.save(data); return gate.promise; });
    const pending = commitPriority(m.remote, () => "A", operation());
    await vi.waitFor(() => expect(m.remote.create).toHaveBeenCalled());
    spaceTabChannel.notifyLocal("user:A", "user:B");
    spaceTabChannel.notifyLocal("user:B", "user:A");
    gate.resolve(m.document);
    expect(await pending).toEqual({ kind: "cancelled" });
  });
  it("serial rapid true → false persists the final revision and old operations conflict", async () => {
    const m = memory();
    await commitPriority(m.remote, () => "A", operation());
    expect((await commitPriority(m.remote, () => "A", { ...operation(2), expectedEntryRevision: 1, priority: false })).kind).toBe("saved");
    expect((await commitPriority(m.remote, () => "A", operation())).kind).toBe("conflict");
    expect(m.document?.entries.eurusd.priority).toBe(false);
  });
  it("checks the returned receipt instead of trusting a nonempty HTTP response", async () => {
    const m = memory();
    const p = proposePriority(null, operation(8));
    if (p.kind !== "write") throw new Error("fixture");
    m.remote.create.mockResolvedValueOnce({ ...p.data, updatedAt: "2026-11-21T10:00:00Z" });
    expect((await commitPriority(m.remote, () => "A", operation())).kind).toBe("conflict");
  });
});

describe("real Supabase JS query contract", () => {
  it("disables SDK retry amplification and aborts a stalled GET within the metadata deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }));
      const client = createClient("http://127.0.0.1:54329", "test-only", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } });
      const job = new SupabaseWatchlistMetaRemote(() => client).read("A").catch(error => error);
      await vi.advanceTimersByTimeAsync(META_HTTP_TIMEOUT_MS);
      expect(await job).toBeInstanceOf(WatchlistMetaError);expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("uses owner/id/revision filters and return=representation; 0 rows stays null", async () => {
    const requests: { url: URL; init: RequestInit }[] = [];
    const client = createClient("http://127.0.0.1:54329", "test-only", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), init: init ?? {} });
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    } } });
    const remote = new SupabaseWatchlistMetaRemote(() => client);
    const p = proposePriority(null, operation()); if (p.kind !== "write") throw new Error("fixture");
    expect(await remote.replace("A", 7, p.data)).toBeNull();
    const r = requests[0];
    expect(r.url.searchParams.get("user_id")).toBe("eq.A");
    expect(r.url.searchParams.get("id")).toBe("eq.watchlist_meta");
    expect(r.url.searchParams.get("data->>revision")).toBe("eq.7");
    expect(r.init.method).toBe("PATCH");
    expect(new Headers(r.init.headers).get("prefer")).toContain("return=representation");
    await remote.create("A", p.data);
    expect(JSON.parse(String(requests[1].init.body)).user_id).toBe("A");
  });
});
