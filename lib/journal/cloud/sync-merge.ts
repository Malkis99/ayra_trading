import type { JournalSnapshot } from "../types";
import type { ImportBatch } from "../import/batches";
import { AppStorage } from "@/lib/storage";
import { sanitizePreferences } from "../preferences";
import { IMPORT_BATCHES_TABLE, SETTINGS_TABLE, entryKey, entryVersion, type CloudEntry, type JournalCloudTable } from "./records";

/**
 * T7b-4b: what to do with records that came from the cloud (plan docs/t7b-4-sync-engine-plan.md, section 2.1).
 *
 * The decision uses the BASE version — the version of the record that last matched the cloud on this device —
 * never the clocks of the devices:
 * | changed here (queued) | changed in the cloud (≠ base) | action                      |
 * | no                    | yes                           | take the cloud version      |
 * | yes                   | no                            | keep ours, it will be sent  |
 * | yes                   | yes, same version             | nothing (already equal)     |
 * | yes                   | yes, different                | conflict (both versions kept) |
 * Deleting on one device and editing on another is a conflict as well (a tombstone is a version too).
 * Exception: the journal settings row (unit, main account, session, primary prop account) — the newer one wins,
 * no dialog (docs/journal-setup-plan.md, section 3).
 */

export interface MergeInput {
  /** Local records of the account by key (tombstones included). */
  local: Map<string, CloudEntry>;
  /** Base versions by key (entryVersion of the last version that matched the cloud). */
  base: Record<string, string>;
  /** Keys with a local change not yet in the cloud (the outbox). */
  pending: Set<string>;
  /** Keys already in conflict. */
  conflicts: Set<string>;
  remote: CloudEntry[];
}

export interface MergePlan {
  /** Cloud versions to write into the local journal. */
  take: CloudEntry[];
  /** New conflicts (cloud version kept aside; the local one stays in the journal). */
  conflicts: CloudEntry[];
  /** Cloud version of records that are already in conflict (newer cloud edits while undecided). */
  conflictUpdates: CloudEntry[];
  /** New base versions. */
  base: Record<string, string>;
  /** Queued keys that turned out to be equal to the cloud: nothing to send. */
  settled: string[];
}

export function planMerge(input: MergeInput): MergePlan {
  const plan: MergePlan = { take: [], conflicts: [], conflictUpdates: [], base: {}, settled: [] };
  for (const r of input.remote) {
    const key = entryKey(r);
    const version = entryVersion(r);
    if (input.conflicts.has(key)) {
      plan.conflictUpdates.push(r);
      continue;
    }
    if (input.base[key] === version) continue; // nothing new in the cloud (e.g. the echo of our own send)
    const local = input.local.get(key);
    if (!input.pending.has(key) || !local) {
      plan.take.push(r);
      plan.base[key] = version;
      continue;
    }
    if (entryVersion(local) === version) {
      plan.base[key] = version;
      plan.settled.push(key);
      continue;
    }
    if (r.table === SETTINGS_TABLE) {
      if (settingsNewer(r, local)) {
        plan.take.push(r); // the cloud is newer: take it, ours is not sent
        plan.base[key] = version;
        plan.settled.push(key);
      } // ours is newer: keep it, it will be sent
      continue;
    }
    plan.conflicts.push(r);
  }
  return plan;
}

/** Journal settings: is `a` newer than `b`? (ISO times compare as text) */
export function settingsNewer(a: CloudEntry, b: CloudEntry): boolean {
  return String(a.record.updatedAt ?? "") > String(b.record.updatedAt ?? "");
}

type ListField = "accounts" | "trades" | "strategies" | "noTrades" | "plans" | "weekPlans" | "notes" | "attachments";
const FIELD_BY_TABLE: Partial<Record<JournalCloudTable, { field: ListField; idKey: string }>> = {
  journal_accounts: { field: "accounts", idKey: "id" },
  journal_trades: { field: "trades", idKey: "id" },
  journal_strategies: { field: "strategies", idKey: "id" },
  journal_no_trades: { field: "noTrades", idKey: "id" },
  journal_day_plans: { field: "plans", idKey: "date" },
  journal_week_plans: { field: "weekPlans", idKey: "weekStartDate" },
  journal_notes: { field: "notes", idKey: "id" },
  journal_attachments: { field: "attachments", idKey: "id" },
};

/** Writes records into a snapshot as they are (replace by id or add). Tombstones stay tombstones (soft delete). */
export function applyEntries(snapshot: JournalSnapshot, batches: ImportBatch[], entries: CloudEntry[]): { snapshot: JournalSnapshot; batches: ImportBatch[] } {
  const next: JournalSnapshot = { ...snapshot };
  for (const spec of Object.values(FIELD_BY_TABLE)) next[spec!.field] = [...(snapshot[spec!.field] || [])] as never;
  const nextBatches = [...batches];
  for (const e of entries) {
    if (e.table === SETTINGS_TABLE) {
      next.primaryPropAccountId = (e.record.primaryPropAccountId as string | null | undefined) ?? null;
      next.preferences = sanitizePreferences(e.record.preferences);
      next.settingsUpdatedAt = String(e.record.updatedAt);
      continue;
    }
    if (e.table === IMPORT_BATCHES_TABLE) {
      const i = nextBatches.findIndex((b) => b.id === e.id);
      if (i >= 0) nextBatches[i] = e.record as unknown as ImportBatch;
      else nextBatches.push(e.record as unknown as ImportBatch);
      continue;
    }
    const spec = FIELD_BY_TABLE[e.table];
    if (!spec) continue;
    const list = next[spec.field] as unknown as Record<string, unknown>[];
    const i = list.findIndex((r) => r[spec.idKey] === e.id);
    if (i >= 0) list[i] = e.record;
    else list.push(e.record);
  }
  return { snapshot: next, batches: nextBatches };
}

/* --------------------------------------------------------------- per-account stores (explicit user) */

const BASE_KEY = "ayra_sync_base";
const CONFLICTS_KEY = "ayra_sync_conflicts";
const CURSOR_KEY = "ayra_journal_cloud_cursor";

function readJson<T>(key: string, userId: string, fallback: T): T {
  try {
    const raw = AppStorage.getItem(key, userId);
    const parsed = raw ? JSON.parse(raw) : fallback;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, userId: string, value: unknown): void {
  try {
    AppStorage.setItem(key, JSON.stringify(value), userId);
  } catch {}
}

export const readBase = (userId: string) => readJson<Record<string, string>>(BASE_KEY, userId, {});
export function updateBase(userId: string, patch: Record<string, string>): void {
  if (!Object.keys(patch).length) return;
  writeJson(BASE_KEY, userId, { ...readBase(userId), ...patch });
}

export interface StoredConflict {
  table: JournalCloudTable;
  id: string;
  /** The cloud version (the device version is the one in the local journal). */
  cloud: CloudEntry["record"];
  detectedAt: string;
}

export const readConflicts = (userId: string) => readJson<Record<string, StoredConflict>>(CONFLICTS_KEY, userId, {});
export function writeConflicts(userId: string, conflicts: Record<string, StoredConflict>): void {
  writeJson(CONFLICTS_KEY, userId, conflicts);
}

export const readCursor = (userId: string) => readJson<Partial<Record<JournalCloudTable, string>>>(CURSOR_KEY, userId, {});
export const writeCursor = (userId: string, cursor: Partial<Record<JournalCloudTable, string>>) => writeJson(CURSOR_KEY, userId, cursor);
