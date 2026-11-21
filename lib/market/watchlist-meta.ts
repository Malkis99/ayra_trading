import { isInstrumentId, type InstrumentId } from "./instruments";

export const WATCHLIST_META_ROW = "watchlist_meta";
export const META_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const stableId = /^[a-z0-9]{1,32}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const revision = (value: unknown, minimum = 1): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

export interface PriorityEntry extends Record<string, unknown> {
  priority: boolean;
  revision: number;
  operationId: string;
}
export interface WatchlistMetaWrite extends Record<string, unknown> {
  id: typeof WATCHLIST_META_ROW;
  version: 1;
  revision: number;
  entries: Record<string, PriorityEntry>;
}
export interface WatchlistMeta extends WatchlistMetaWrite { updatedAt: string }
export type MetaSnapshot = { kind: "missing" } | { kind: "invalid" } | { kind: "unsupported"; raw: Record<string, unknown> } | { kind: "v1"; document: WatchlistMeta };

/** Never normalize an opaque/newer document into an empty V1 record. */
export function parseWatchlistMeta(raw: unknown): MetaSnapshot {
  if (raw === null) return { kind: "missing" };
  if (!object(raw) || raw.id !== WATCHLIST_META_ROW || !revision(raw.version)) return { kind: "invalid" };
  if (raw.version !== 1) return { kind: "unsupported", raw };
  if (!revision(raw.revision) || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt)) || !object(raw.entries)) return { kind: "invalid" };
  const seen = new Set<string>();
  for (const [id, entry] of Object.entries(raw.entries)) {
    if (!stableId.test(id) || !object(entry) || typeof entry.priority !== "boolean" || !revision(entry.revision)
      || typeof entry.operationId !== "string" || !META_OPERATION_ID.test(entry.operationId) || seen.has(entry.operationId)) return { kind: "invalid" };
    seen.add(entry.operationId);
  }
  return { kind: "v1", document: raw as WatchlistMeta };
}

export interface PriorityOperation {
  userId: string;
  instrument: InstrumentId;
  priority: boolean;
  expectedEntryRevision: number;
  operationId: string;
}
export function validPriorityOperation(op: PriorityOperation): boolean {
  return object(op) && typeof op.userId === "string" && !!op.userId && isInstrumentId(op.instrument) && typeof op.priority === "boolean"
    && revision(op.expectedEntryRevision, 0) && op.expectedEntryRevision < Number.MAX_SAFE_INTEGER
    && typeof op.operationId === "string" && META_OPERATION_ID.test(op.operationId);
}

export type PriorityProposal = { kind: "applied"; document: WatchlistMeta } | { kind: "conflict"; document: WatchlistMeta }
  | { kind: "write"; expectedRevision: number; data: WatchlistMetaWrite } | { kind: "invalid" };

/** Only independent instruments rebase automatically. Same-instrument conflicts never guess intent from clocks. */
export function proposePriority(document: WatchlistMeta | null, op: PriorityOperation): PriorityProposal {
  if (!validPriorityOperation(op)) return { kind: "invalid" };
  const entry = document?.entries[op.instrument];
  if (entry?.operationId === op.operationId) {
    return entry.priority === op.priority && entry.revision === op.expectedEntryRevision + 1
      ? { kind: "applied", document: document! } : { kind: "conflict", document: document! };
  }
  if (document && ((entry?.revision ?? 0) !== op.expectedEntryRevision
    || Object.values(document.entries).some(e => e.operationId === op.operationId))) return { kind: "conflict", document };
  if (!document && op.expectedEntryRevision !== 0) return { kind: "invalid" };
  if (document && document.revision >= Number.MAX_SAFE_INTEGER) return { kind: "invalid" };
  return { kind: "write", expectedRevision: document?.revision ?? 0, data: {
    ...document, id: WATCHLIST_META_ROW, version: 1, revision: (document?.revision ?? 0) + 1,
    entries: { ...document?.entries, [op.instrument]: { ...entry, priority: op.priority, revision: op.expectedEntryRevision + 1, operationId: op.operationId } },
  } };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Future cache users must not apply an older acknowledgement over a newer confirmed read. No UI state is written. */
export function acceptConfirmedMeta(current: WatchlistMeta | null, incoming: WatchlistMeta): { kind: "accepted" | "older" | "same" | "conflict"; document: WatchlistMeta } {
  if (!current || incoming.revision > current.revision) return { kind: "accepted", document: incoming };
  if (incoming.revision < current.revision) return { kind: "older", document: current };
  return { kind: canonical(incoming) === canonical(current) ? "same" : "conflict", document: current };
}
