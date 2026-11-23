/**
 * Q4.5-4 — the device's part of the transfer (docs/q4-5-4-migration-provenance-audit.md, section «Офлайн-устройства»).
 *
 * When the device first learns that its account is in the transfer window (migration_pending) — or already moved
 * (cloud_active: a device that was offline) — it FREEZES its saved game state once, as it is, under a random snapshot
 * id, and sends that same frozen copy until the server answers. A retry is the same id and the same content: the server
 * sees a replay, never a second snapshot. The device's own progress is never changed or deleted by this.
 *
 * Kept in the account's storage space:
 *   ayra_migration_install  — a random id of this storage (groups snapshots; it proves nothing about a device)
 *   ayra_migration_snapshot — { snapshotId, frozenAt, state } — written once, never rewritten
 *   ayra_migration_upload   — the server's final answer { status, receivedAt, replay }
 */
import type { EconomyMode } from "../economy-mode";
import type { RequestScope } from "../economy-scope";
import { callDayApi, type DayCall } from "../server-day-client";

export const INSTALL_KEY = "ayra_migration_install";
export const SNAPSHOT_KEY = "ayra_migration_snapshot";
export const UPLOAD_KEY = "ayra_migration_upload";
export const SNAPSHOT_PATH = "/api/game/migration/snapshot";

/** The storage of one account space (reads and guarded writes). */
export interface SpaceKV {
  get(key: string): string | null;
  /** false: the write was dropped (the device left the space meanwhile) */
  set(key: string, value: string): boolean;
}

export interface FrozenSnapshot {
  snapshotId: string;
  frozenAt: string;
  state: Record<string, unknown>;
}

export type UploadStatus = "accepted" | "duplicate_install" | "late";
export interface UploadRecord {
  status: UploadStatus;
  receivedAt: string | null;
  replay: boolean;
}

/** What the game shows (null: nothing to say). */
export type TransferView = "waiting" | "sent" | "late" | "tooLarge" | null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export function readUpload(kv: SpaceKV): UploadRecord | null {
  const r = parse<UploadRecord>(kv.get(UPLOAD_KEY));
  return r && ["accepted", "duplicate_install", "late"].includes(r.status) ? r : null;
}

export function transferViewOf(mode: EconomyMode, upload: UploadRecord | null, lastError: string | null): TransferView {
  if (upload) return upload.status === "late" ? "late" : "sent";
  if (lastError === "import_too_large") return "tooLarge";
  return mode === "migration_pending" || mode === "cloud_active" ? "waiting" : null;
}

function installIdOf(kv: SpaceKV, uuid: () => string): string | null {
  const known = kv.get(INSTALL_KEY);
  if (known && UUID_RE.test(known)) return known;
  const id = uuid();
  return kv.set(INSTALL_KEY, id) ? id : null;
}

/** The frozen copy: the one already written, or a new one of `rawState` (the saved game JSON) — never rewritten. */
export function freezeSnapshot(kv: SpaceKV, rawState: string | null, now: Date, uuid: () => string): FrozenSnapshot | null {
  const known = parse<FrozenSnapshot>(kv.get(SNAPSHOT_KEY));
  if (known && typeof known.snapshotId === "string" && UUID_RE.test(known.snapshotId) && known.state && typeof known.state === "object") return known;
  const state = parse<Record<string, unknown>>(rawState);
  if (!state || typeof state !== "object" || Array.isArray(state)) return null; // nothing saved here: nothing to send
  const frozen: FrozenSnapshot = { snapshotId: uuid(), frozenAt: now.toISOString(), state };
  return kv.set(SNAPSHOT_KEY, JSON.stringify(frozen)) ? frozen : null;
}

export interface UploadDeps {
  kv: SpaceKV;
  /** the saved game state of the space, as stored */
  rawState: string | null;
  now: Date;
  uuid: () => string;
  /** sends the request for the scope (callDayApi in the app; one session refresh on session_stale) */
  send?: (body: unknown, scope: RequestScope) => Promise<DayCall>;
  /** is the device still where the request was made, and is the answer about that account? */
  belongs: (scope: RequestScope, answeredAccount: string | undefined) => boolean;
}

export type UploadOutcome =
  | { kind: "done"; record: UploadRecord }
  | { kind: "nothing" }
  | { kind: "retry"; error: string; state?: EconomyMode }
  | { kind: "ignored" };

/** One attempt (the game calls it again later — on focus, on the next load — until an answer is kept). */
export async function uploadSnapshotOnce(mode: EconomyMode, scope: RequestScope, deps: UploadDeps): Promise<UploadOutcome> {
  const kept = readUpload(deps.kv);
  if (kept) return { kind: "done", record: kept };
  // before the window nothing is sent: what the device earns until then is part of its progress (owner, 2026-11-18)
  if (mode !== "migration_pending" && mode !== "cloud_active") return { kind: "nothing" };
  const frozen = freezeSnapshot(deps.kv, deps.rawState, deps.now, deps.uuid);
  const installId = installIdOf(deps.kv, deps.uuid);
  if (!frozen || !installId) return { kind: "nothing" };
  const send = deps.send ?? ((body: unknown, s: RequestScope) => callDayApi(SNAPSHOT_PATH, "POST", body, fetch, undefined, undefined, s));
  const r = await send({ snapshotId: frozen.snapshotId, installId, schema: 1, state: frozen.state }, scope);
  if (!deps.belongs(scope, r.account)) return { kind: "ignored" };
  if (!r.ok) return { kind: "retry", error: r.error, ...(r.state ? { state: r.state } : {}) };
  const b = r.body as { status?: unknown; receivedAt?: unknown; replay?: unknown };
  if (b.status !== "accepted" && b.status !== "duplicate_install" && b.status !== "late") return { kind: "retry", error: "bad_response" };
  const record: UploadRecord = { status: b.status, receivedAt: typeof b.receivedAt === "string" ? b.receivedAt : null, replay: b.replay === true };
  deps.kv.set(UPLOAD_KEY, JSON.stringify(record));
  return { kind: "done", record };
}
