import type { SupabaseClient } from "@supabase/supabase-js";
import { captureMarketAccount } from "./account-scope";
import { parseWatchlistMeta, proposePriority, validPriorityOperation, WATCHLIST_META_ROW, type PriorityOperation, type WatchlistMeta, type WatchlistMetaWrite } from "./watchlist-meta";

export const META_CAS_ATTEMPTS = 3;
export class WatchlistMetaError extends Error {
  constructor(public readonly code: string | undefined, message: string) { super(message); this.name = "WatchlistMetaError"; }
}
export interface WatchlistMetaRemote {
  currentUserId(): Promise<string | null>;
  isSyncEnabled(userId: string): Promise<boolean>;
  read(userId: string): Promise<unknown>;
  create(userId: string, data: WatchlistMetaWrite): Promise<unknown>;
  replace(userId: string, expectedRevision: number, data: WatchlistMetaWrite): Promise<unknown>;
}
const checked = (error: { code?: string; message?: string } | null) => {
  if (error) throw new WatchlistMetaError(error.code || undefined, error.message || "market_meta_remote_failed");
};

/** Dormant foundation: no UI, automatic reads/writes, local storage, new RPC or service-role client. */
export class SupabaseWatchlistMetaRemote implements WatchlistMetaRemote {
  constructor(private readonly getClient: () => SupabaseClient | null) {}
  private client() { const c = this.getClient(); if (!c) throw new WatchlistMetaError("not_configured", "market_meta_not_configured"); return c; }
  async currentUserId() { const { data, error } = await this.client().auth.getSession(); checked(error); return data.session?.user.id ?? null; }
  async isSyncEnabled(userId: string) {
    const { data, error } = await this.client().from("user_features").select("cloud_sync").eq("user_id", userId).maybeSingle();
    checked(error); return data?.cloud_sync === true;
  }
  async read(userId: string) {
    const { data, error } = await this.client().from("market_user_data").select("data").eq("user_id", userId).eq("id", WATCHLIST_META_ROW).maybeSingle();
    checked(error); return data?.data ?? null;
  }
  async create(userId: string, data: WatchlistMetaWrite) {
    const result = await this.client().from("market_user_data").insert({ user_id: userId, id: WATCHLIST_META_ROW, data }).select("data").maybeSingle();
    if (result.error?.code === "23505") return null; // concurrent first creation; read/rebase within the bounded loop
    checked(result.error); return result.data?.data ?? null;
  }
  async replace(userId: string, expectedRevision: number, data: WatchlistMetaWrite) {
    const result = await this.client().from("market_user_data").update({ data }).eq("user_id", userId).eq("id", WATCHLIST_META_ROW)
      .eq("data->>revision", String(expectedRevision)).select("data").maybeSingle();
    checked(result.error); return result.data?.data ?? null; // empty representation is NOT an acknowledgement
  }
}

export type PriorityCommit = { kind: "saved"; document: WatchlistMeta; replay: boolean }
  | { kind: "conflict"; document: WatchlistMeta } | { kind: "pending"; reason: "network" | "contended" | "unconfirmed" }
  | { kind: "cancelled" | "disabled" | "invalid" | "unsupported" } | { kind: "refused"; code?: string };

function confirmation(raw: unknown, op: PriorityOperation): PriorityCommit | null {
  const snapshot = parseWatchlistMeta(raw);
  if (snapshot.kind === "unsupported" || snapshot.kind === "invalid") return { kind: snapshot.kind };
  if (snapshot.kind === "missing") return null;
  const proposal = proposePriority(snapshot.document, op);
  if (proposal.kind === "applied") return { kind: "saved", document: proposal.document, replay: true };
  if (proposal.kind === "conflict") return proposal;
  if (proposal.kind === "invalid") return proposal;
  return null;
}

/** No UI/cache writes here. The caller retains its operation on pending/cancelled and never treats 0 rows as saved. */
export async function commitPriority(remote: WatchlistMetaRemote, readUserId: () => string | null, op: PriorityOperation): Promise<PriorityCommit> {
  if (!validPriorityOperation(op)) return { kind: "invalid" };
  const scope = captureMarketAccount(readUserId);
  let writeStarted = false;
  try {
    if (!scope.current() || scope.userId !== op.userId) return { kind: "cancelled" };
    const sessionUser = await remote.currentUserId();
    if (!scope.current() || sessionUser !== op.userId) return { kind: "cancelled" };
    const enabled = await remote.isSyncEnabled(op.userId);
    if (!scope.current()) return { kind: "cancelled" };
    if (!enabled) return { kind: "disabled" };
    for (let attempt = 0; attempt < META_CAS_ATTEMPTS; attempt++) {
      const raw = await remote.read(op.userId);
      if (!scope.current()) return { kind: "cancelled" };
      const snapshot = parseWatchlistMeta(raw);
      if (snapshot.kind === "invalid" || snapshot.kind === "unsupported") return { kind: snapshot.kind };
      const proposal = proposePriority(snapshot.kind === "v1" ? snapshot.document : null, op);
      if (proposal.kind === "applied") return { kind: "saved", document: proposal.document, replay: true };
      if (proposal.kind !== "write") return proposal;
      writeStarted = true;
      const written = proposal.expectedRevision === 0 ? await remote.create(op.userId, proposal.data)
        : await remote.replace(op.userId, proposal.expectedRevision, proposal.data);
      if (!scope.current()) return { kind: "cancelled" };
      if (written === null) continue;
      const result = confirmation(written, op);
      if (result?.kind === "saved") return { ...result, replay: false };
      return result ?? { kind: "pending", reason: "unconfirmed" };
    }
    return { kind: "pending", reason: "contended" };
  } catch (error) {
    if (!scope.current()) return { kind: "cancelled" };
    if (error instanceof WatchlistMetaError && error.code) return { kind: "refused", code: error.code };
    if (writeStarted) {
      try {
        const raw = await remote.read(op.userId);
        if (!scope.current()) return { kind: "cancelled" };
        const result = confirmation(raw, op);
        if (result) return result;
      } catch { if (!scope.current()) return { kind: "cancelled" }; }
    }
    return { kind: "pending", reason: "network" };
  } finally { scope.dispose(); }
}
