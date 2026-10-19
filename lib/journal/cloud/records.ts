import type { JournalSnapshot } from "../types";
import type { ImportBatch } from "../import/batches";
import { CURRENT_JOURNAL_SCHEMA_VERSION } from "../repository";
import { JOURNAL_CLOUD_FORBIDDEN_KEYS, JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS, JOURNAL_CLOUD_MAX_RECORD_BYTES } from "./config";

/**
 * Mapping between the local journal (one JSON document) and the 9 cloud tables of migration 0004.
 * Pure functions: no storage, no network.
 */

type ListField = "accounts" | "trades" | "strategies" | "noTrades" | "plans" | "weekPlans" | "notes";

const LIST_TABLES = [
  { table: "journal_accounts", field: "accounts", idKey: "id" },
  { table: "journal_trades", field: "trades", idKey: "id" },
  { table: "journal_strategies", field: "strategies", idKey: "id" },
  { table: "journal_no_trades", field: "noTrades", idKey: "id" },
  { table: "journal_day_plans", field: "plans", idKey: "date" },
  { table: "journal_week_plans", field: "weekPlans", idKey: "weekStartDate" },
  { table: "journal_notes", field: "notes", idKey: "id" },
] as const satisfies readonly { table: string; field: ListField; idKey: string }[];

export const SETTINGS_TABLE = "journal_settings";
export const SETTINGS_ROW_ID = "journal";
export const IMPORT_BATCHES_TABLE = "journal_import_batches";

export type JournalCloudTable =
  | (typeof LIST_TABLES)[number]["table"]
  | typeof SETTINGS_TABLE
  | typeof IMPORT_BATCHES_TABLE;

export const JOURNAL_CLOUD_TABLES: readonly JournalCloudTable[] = [
  ...LIST_TABLES.map((t) => t.table),
  IMPORT_BATCHES_TABLE,
  SETTINGS_TABLE,
];

/** Trades carry their own schemaVersion field; for other records it exists only in the cloud copy. */
const OWN_SCHEMA_VERSION_TABLE: JournalCloudTable = "journal_trades";

type AnyRecord = Record<string, unknown>;

/** One journal record addressed by cloud table and row id. */
export interface CloudEntry {
  table: JournalCloudTable;
  id: string;
  record: AnyRecord;
}

/** What the client sends: the server fills every other column itself (0004 trigger). */
export interface JournalCloudWriteRow {
  id: string;
  data: AnyRecord;
  device_id: string | null;
}

/** What the client reads back. */
export interface JournalCloudReadRow {
  id: string;
  data: AnyRecord;
  updated_at: string;
}

export type EncodeSkipReason = "tooLarge" | "fromFuture" | "missingUpdatedAt";
export type EncodeResult = { ok: true; row: JournalCloudWriteRow } | { ok: false; reason: EncodeSkipReason };

/** Every record of the snapshot (tombstones included) plus import history and journal settings. */
export function snapshotEntries(snapshot: JournalSnapshot, batches: ImportBatch[]): CloudEntry[] {
  const out: CloudEntry[] = [];
  for (const spec of LIST_TABLES) {
    for (const r of (snapshot[spec.field] || []) as unknown as AnyRecord[]) {
      const id = r[spec.idKey];
      if (typeof id === "string" && id) out.push({ table: spec.table, id, record: r });
    }
  }
  out.push(...importBatchEntries(batches));
  if (snapshot.settingsUpdatedAt) {
    out.push({
      table: SETTINGS_TABLE,
      id: SETTINGS_ROW_ID,
      record: { id: SETTINGS_ROW_ID, primaryPropAccountId: snapshot.primaryPropAccountId ?? null, updatedAt: snapshot.settingsUpdatedAt },
    });
  }
  return out;
}

export function importBatchEntries(batches: ImportBatch[]): CloudEntry[] {
  return batches.filter((b) => b.id).map((b) => ({ table: IMPORT_BATCHES_TABLE, id: b.id, record: b as unknown as AnyRecord }));
}

export const entryKey = (e: { table: string; id: string }) => `${e.table}:${e.id}`;

/** Changes whenever a record is saved, deleted or restored (every local write stamps updatedAt). */
export function entryVersion(e: CloudEntry): string {
  const r = e.record;
  return `${String(r.updatedAt ?? "")}|${String(r.deletedAt ?? r.undoneAt ?? "")}`;
}

/** Entries that differ from the versions captured before a write. */
export function changedEntries(before: Map<string, string>, after: CloudEntry[]): CloudEntry[] {
  return after.filter((e) => before.get(entryKey(e)) !== entryVersion(e));
}

export function versionMap(entries: CloudEntry[]): Map<string, string> {
  return new Map(entries.map((e) => [entryKey(e), entryVersion(e)]));
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Byte length of the value as Postgres prints jsonb (`data::text`, what the 0004 size check measures):
 * like JSON, but with ", " and ": " separators.
 */
export function jsonbTextLength(value: unknown): number {
  if (value === null) return 4;
  if (Array.isArray(value)) {
    const parts = value.map((v) => (v === undefined || typeof v === "function" ? 4 : jsonbTextLength(v)));
    return 2 + parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * 2;
  }
  switch (typeof value) {
    case "string":
      return utf8Length(JSON.stringify(value));
    case "number":
      return Number.isFinite(value) ? String(value).length : 4;
    case "boolean":
      return value ? 4 : 5;
    case "object": {
      const parts = Object.entries(value as AnyRecord)
        .filter(([, v]) => v !== undefined && typeof v !== "function")
        .map(([k, v]) => utf8Length(JSON.stringify(k)) + 2 + jsonbTextLength(v));
      return 2 + parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * 2;
    }
    default:
      return 0;
  }
}

/** The cloud copy of a record: no reward fields, schemaVersion inside. */
export function cloudData(e: CloudEntry): AnyRecord {
  const data: AnyRecord = { ...e.record };
  for (const k of JOURNAL_CLOUD_FORBIDDEN_KEYS) delete data[k];
  if (typeof data.schemaVersion !== "number") data.schemaVersion = CURRENT_JOURNAL_SCHEMA_VERSION;
  if (e.table === IMPORT_BATCHES_TABLE && !data.updatedAt) data.updatedAt = data.createdAt;
  return data;
}

export function encodeEntry(e: CloudEntry, deviceId: string | null, now: Date = new Date()): EncodeResult {
  const data = cloudData(e);
  const changedAt = Date.parse(String(data.updatedAt ?? ""));
  if (Number.isNaN(changedAt)) return { ok: false, reason: "missingUpdatedAt" };
  if (changedAt > now.getTime() + JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS) return { ok: false, reason: "fromFuture" };
  if (jsonbTextLength(data) > JOURNAL_CLOUD_MAX_RECORD_BYTES) return { ok: false, reason: "tooLarge" };
  return { ok: true, row: { id: e.id, data, device_id: deviceId } };
}

export type DecodeResult = { ok: true; entry: CloudEntry } | { ok: false; reason: "newerSchema" | "invalid" };

/** A row from the server back to a local record. Records written by a newer app version are left alone. */
export function decodeRow(table: JournalCloudTable, row: JournalCloudReadRow): DecodeResult {
  const data = row?.data;
  if (!data || typeof data !== "object" || typeof row.id !== "string") return { ok: false, reason: "invalid" };
  const version = data.schemaVersion;
  if (typeof version === "number" && version > CURRENT_JOURNAL_SCHEMA_VERSION) return { ok: false, reason: "newerSchema" };
  const record: AnyRecord = { ...data };
  for (const k of JOURNAL_CLOUD_FORBIDDEN_KEYS) delete record[k];
  if (table !== OWN_SCHEMA_VERSION_TABLE) delete record.schemaVersion;
  if (typeof record.updatedAt !== "string" && table !== IMPORT_BATCHES_TABLE) return { ok: false, reason: "invalid" };
  return { ok: true, entry: { table, id: row.id, record } };
}
