import { captureMarketAccount } from "./account-scope";
import { acceptConfirmedMeta, parseWatchlistMeta, type PriorityOperation, type WatchlistMeta } from "./watchlist-meta";
import { commitPriority, type WatchlistMetaRemote } from "./watchlist-meta-sync";
import type { InstrumentId } from "./instruments";

export type PriorityStatus = "pending" | "conflict" | "error";
export interface QueuedPriority { operation: PriorityOperation; status: PriorityStatus }
export interface PriorityAccount {
  version: 1;
  raw: unknown;
  enabled: boolean | null;
  checked?: boolean;
  queue: QueuedPriority[];
  issue?: "network" | "unsupported" | "invalid" | "error";
}
export const emptyPriorityAccount = (): PriorityAccount => ({ version: 1, raw: null, enabled: null, queue: [] });
export interface PriorityStore {
  read(userId: string): Promise<PriorityAccount>;
  update(userId: string, change: (current: PriorityAccount) => PriorityAccount): Promise<PriorityAccount>;
}
export function priorityDocument(record: PriorityAccount): WatchlistMeta | null {
  const parsed = parseWatchlistMeta(record.raw);
  return parsed.kind === "v1" ? parsed.document : null;
}
export function priorityValue(record: PriorityAccount, id: InstrumentId): boolean {
  return record.queue.filter(q => q.operation.instrument === id).at(-1)?.operation.priority ?? priorityDocument(record)?.entries[id]?.priority ?? false;
}
function mergeConfirmed(record: PriorityAccount, raw: unknown): PriorityAccount {
  const incoming = parseWatchlistMeta(raw), previous = parseWatchlistMeta(record.raw);
  if (incoming.kind === "unsupported" || previous.kind === "unsupported") return { ...record, raw: incoming.kind === "unsupported" ? raw : record.raw, issue: "unsupported" };
  if (incoming.kind === "invalid") return { ...record, issue: "invalid" };
  if (incoming.kind === "missing") return previous.kind === "v1" ? { ...record, issue: "error" } : { ...record, checked: true, issue: undefined };
  const accepted = acceptConfirmedMeta(previous.kind === "v1" ? previous.document : null, incoming.document);
  return { ...record, raw: accepted.document, checked: true, issue: accepted.kind === "conflict" ? "error" : undefined };
}

/** Durable outbox: each click gets one UUID; only confirmed receipts remove operations. No client-clock arbitration. */
export class PriorityQueue {
  private running: Promise<void> | null = null;
  private active = true;
  private again = false;
  constructor(readonly userId: string, private remote: WatchlistMetaRemote, private store: PriorityStore,
    private readUser: () => string | null, private online: () => boolean, private uuid: () => string) {}
  dispose() { this.active = false; }
  private current = () => this.active && this.readUser() === this.userId ? this.userId : null;
  async enqueue(instrument: InstrumentId, priority?: boolean) {
    if (!this.current()) return;
    // The click is already bound to this account. Persist its intent even if sign-out
    // happens while IndexedDB opens; it can never write another account or Guest.
    await this.store.update(this.userId, record => {
      if (record.enabled !== true || !record.checked || record.issue === "unsupported" || record.issue === "invalid" || record.issue === "error") return record;
      const chain = record.queue.filter(q => q.operation.instrument === instrument);
      if (chain.some(q => q.status !== "pending")) return record; // explicit conflict resolution, never silently rebase
      const revision = chain.at(-1)?.operation.expectedEntryRevision;
      const operation: PriorityOperation = { userId: this.userId, instrument, priority: priority ?? !priorityValue(record, instrument), operationId: this.uuid(),
        expectedEntryRevision: revision === undefined ? priorityDocument(record)?.entries[instrument]?.revision ?? 0 : revision + 1 };
      return { ...record, queue: [...record.queue, { operation, status: "pending" }] };
    });
    await this.run();
  }
  /** Explicit resolution only: keep cloud, or replace the conflicted chain with the latest intent after a fresh read. */
  async resolve(instrument: InstrumentId, keepMine: boolean) {
    await this.run();
    if (!this.current() || !this.online()) return;
    const scope = captureMarketAccount(this.current);
    try {
      await this.store.update(this.userId, record => {
        if (!scope.current() || record.issue || record.enabled !== true) return record;
        const chain = record.queue.filter(q => q.operation.instrument === instrument);
        if (!chain.length) return record;
        const queue = record.queue.filter(q => q.operation.instrument !== instrument);
        if (keepMine) queue.push({ status: "pending", operation: { userId: this.userId, instrument,
          priority: chain.at(-1)!.operation.priority, operationId: this.uuid(), expectedEntryRevision: priorityDocument(record)?.entries[instrument]?.revision ?? 0 } });
        return { ...record, queue };
      });
    } finally { scope.dispose(); }
    await this.run();
  }
  run(): Promise<void> {
    if (!this.current() || !this.online()) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => { do { this.again = false; await this.exchange(); } while (this.again && this.current() && this.online()); })().finally(() => { this.running = null; });
    return this.running;
  }
  private async exchange() {
    const scope = captureMarketAccount(this.current);
    const update = (change: (r: PriorityAccount) => PriorityAccount) => this.store.update(this.userId, r => scope.current() ? change(r) : r);
    try {
      if (await this.remote.currentUserId() !== this.userId || !scope.current()) return;
      const enabled = await this.remote.isSyncEnabled(this.userId);
      if (!scope.current()) return;
      await update(r => ({ ...r, enabled }));
      if (!enabled || !scope.current()) return;
      const raw = await this.remote.read(this.userId);
      if (!scope.current()) return;
      let record = await update(r => mergeConfirmed(r, raw));
      if (record.issue) return;
      while (scope.current() && this.online()) {
        record = await this.store.read(this.userId);
        const next = record.queue.find(q => q.status === "pending");
        if (!next || record.issue === "unsupported" || record.issue === "invalid") return;
        const result = await commitPriority(this.remote, this.current, next.operation);
        if (!scope.current() || result.kind === "cancelled") return;
        if (result.kind === "saved") {
          await update(r => ({ ...mergeConfirmed(r, result.document), queue: r.queue.filter(q => q.operation.operationId !== next.operation.operationId) }));
        } else if (result.kind === "conflict") {
          await update(r => ({ ...mergeConfirmed(r, result.document), queue: r.queue.map(q => q.operation.instrument === next.operation.instrument ? { ...q, status: "conflict" } : q) }));
        } else if (result.kind === "disabled") { await update(r => ({ ...r, enabled: false })); return;
        } else if (result.kind === "pending") { await update(r => ({ ...r, issue: "network" })); return;
        } else { await update(r => ({ ...r, issue: result.kind === "unsupported" || result.kind === "invalid" ? result.kind : "error", queue: r.queue.map(q => q.operation.operationId === next.operation.operationId ? { ...q, status: "error" } : q) })); return; }
      }
    } catch { if (scope.current()) await update(r => ({ ...r, issue: "network" })).catch(() => {}); }
    finally { scope.dispose(); }
  }
}
