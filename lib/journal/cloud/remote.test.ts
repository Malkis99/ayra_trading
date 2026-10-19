import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseJournalRemote, JournalCloudError } from "./remote";
import { JOURNAL_CLOUD_PAGE_SIZE } from "./config";

type Call = { method: string; args: unknown[] };

/** Mock of the supabase-js query builder: records the chain, resolves with the next queued response. */
function mockClient(responses: { data?: unknown; error?: { code?: string; message: string } | null }[], userId: string | null = "u1") {
  const calls: Call[][] = [];
  const builder = () => {
    const chain: Call[] = [];
    calls.push(chain);
    const proxy: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "gt", "in", "order", "range", "upsert", "maybeSingle"]) {
      proxy[m] = (...args: unknown[]) => {
        chain.push({ method: m, args });
        return proxy;
      };
    }
    proxy.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null, ...responses.shift() });
    return proxy;
  };
  const client = {
    from: (table: string) => (builder() as { from: (t: string) => unknown }).from(table),
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("T7b-3 Supabase journal remote", () => {
  it("not configured: no user, network calls fail with a clear error", async () => {
    const remote = new SupabaseJournalRemote(() => null);
    expect(await remote.currentUserId()).toBeNull();
    await expect(remote.isSyncEnabled("u1")).rejects.toBeInstanceOf(JournalCloudError);
  });

  it("flag: reads user_features.cloud_sync of the user; no row = off", async () => {
    const { client, calls } = mockClient([{ data: { cloud_sync: true } }, { data: null }]);
    const remote = new SupabaseJournalRemote(() => client);
    expect(await remote.currentUserId()).toBe("u1");
    expect(await remote.isSyncEnabled("u1")).toBe(true);
    expect(await remote.isSyncEnabled("u1")).toBe(false);
    expect(calls[0]).toEqual([
      { method: "from", args: ["user_features"] },
      { method: "select", args: ["cloud_sync"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("server error becomes a JournalCloudError (the repository catches it)", async () => {
    const { client } = mockClient([{ error: { code: "42501", message: "permission denied" } }]);
    const err = await new SupabaseJournalRemote(() => client).isSyncEnabled("u1").catch((e) => e);
    expect(err).toBeInstanceOf(JournalCloudError);
    expect(err.code).toBe("42501");
  });

  it("upsert: only id, data, device_id; conflict on (user_id, id); empty list = no request", async () => {
    const { client, calls } = mockClient([{}]);
    const remote = new SupabaseJournalRemote(() => client);
    await remote.upsert("journal_trades", []);
    expect(calls).toHaveLength(0);
    const rows = [{ id: "tr_1", data: { id: "tr_1", updatedAt: "2026-10-18T10:00:00Z" }, device_id: "dev_1" }];
    await remote.upsert("journal_trades", rows);
    expect(calls[0]).toEqual([
      { method: "from", args: ["journal_trades"] },
      { method: "upsert", args: [rows, { onConflict: "user_id,id" }] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("fetchSince: changes after the cursor, oldest first, page by page", async () => {
    const page = Array.from({ length: JOURNAL_CLOUD_PAGE_SIZE }, (_, i) => ({ id: `tr_${i}`, data: {}, updated_at: "t" }));
    const { client, calls } = mockClient([{ data: page }, { data: [{ id: "tr_last", data: {}, updated_at: "t" }] }]);
    const rows = await new SupabaseJournalRemote(() => client).fetchSince("journal_trades", "2026-10-18T10:00:00Z");
    expect(rows).toHaveLength(JOURNAL_CLOUD_PAGE_SIZE + 1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContainEqual({ method: "gt", args: ["updated_at", "2026-10-18T10:00:00Z"] });
    expect(calls[0]).toContainEqual({ method: "order", args: ["updated_at", { ascending: true }] });
    expect(calls[1]).toContainEqual({ method: "range", args: [JOURNAL_CLOUD_PAGE_SIZE, 2 * JOURNAL_CLOUD_PAGE_SIZE - 1] });
  });

  it("upsert reports which rows the server took; fetchByIds reads current rows", async () => {
    const { client, calls } = mockClient([{ data: [{ id: "tr_1" }] }, { data: [{ id: "tr_2", data: {}, updated_at: "t" }] }]);
    const remote = new SupabaseJournalRemote(() => client);
    const rows = ["tr_1", "tr_2"].map((id) => ({ id, data: { id }, device_id: null }));
    expect(await remote.upsert("journal_trades", rows)).toEqual({ written: ["tr_1"] });
    expect(await remote.fetchByIds("journal_trades", ["tr_2"])).toEqual([{ id: "tr_2", data: {}, updated_at: "t" }]);
    expect(calls[1]).toContainEqual({ method: "in", args: ["id", ["tr_2"]] });
  });

  it("fetchSince without a cursor reads everything", async () => {
    const { client, calls } = mockClient([{ data: [] }]);
    await new SupabaseJournalRemote(() => client).fetchSince("journal_notes", null);
    expect(calls[0].some((c) => c.method === "gt")).toBe(false);
  });
});
