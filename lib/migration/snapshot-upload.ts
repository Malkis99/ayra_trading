/**
 * Q4.5-4 — the device's part of the transfer (docs/q4-5-4-migration-provenance-audit.md, section «Офлайн-устройства»).
 *
 * When the device first learns that its account is in the transfer window (migration_pending) — or already moved
 * (cloud_active: a device that was offline) — it FREEZES its saved game state once, as it is, under a random snapshot
 * id, and sends that same frozen copy until the server answers. A retry is the same id and the same content: the server
 * sees a replay, never a second snapshot. The device's own progress is never changed or deleted by this.
 *
 * Q4.6 (docs/q4-6-achievements-migration.md, «Большие снимки»): a save above 1 MiB is frozen COMPRESSED (gzip, with
 * its byte length and SHA-256) and sent in one request; the server unpacks it within hard limits and stores the same
 * content it would have stored uncompressed. Saves up to 1 MiB are sent exactly as before. A browser that cannot
 * compress keeps its save and is told so; nothing is sent half.
 *
 * Kept in the account's storage space:
 *   ayra_migration_install  — a random id of this storage (groups snapshots; it proves nothing about a device)
 *   ayra_migration_snapshot — { snapshotId, frozenAt, state } or, for a large save, { snapshotId, frozenAt, encoding:
 *                             "gzip", stateGzip, stateBytes, stateSha256 } — written once, never rewritten
 *   ayra_migration_upload   — the server's final answer { status, receivedAt, replay }
 */
import type { EconomyMode } from "../economy-mode";
import type { RequestScope } from "../economy-scope";
import { callDayApi, type DayCall } from "../server-day-client";

export const INSTALL_KEY = "ayra_migration_install";
export const SNAPSHOT_KEY = "ayra_migration_snapshot";
export const UPLOAD_KEY = "ayra_migration_upload";
export const SNAPSHOT_PATH = "/api/game/migration/snapshot";

/** Up to this many bytes of saved JSON the snapshot goes as it is (the Q4.5-4 request, unchanged). */
export const PLAIN_MAX_BYTES = 1024 * 1024;
/** The largest save that can be sent at all (the server's limit after unpacking; measured, docs/q4-6 section 6). */
export const RAW_MAX_BYTES = 4 * 1024 * 1024;
/** The largest compressed body (the server's limit before unpacking). */
export const GZIP_MAX_BYTES = 1024 * 1024;

/** The storage of one account space (reads and guarded writes). */
export interface SpaceKV {
  get(key: string): string | null;
  /** false: the write was dropped (the device left the space meanwhile, or the storage is full) */
  set(key: string, value: string): boolean;
}

export interface PlainFrozen {
  snapshotId: string;
  frozenAt: string;
  state: Record<string, unknown>;
}
export interface PackedFrozen {
  snapshotId: string;
  frozenAt: string;
  encoding: "gzip";
  /** base64 of the gzip of the saved JSON exactly as it was stored */
  stateGzip: string;
  stateBytes: number;
  stateSha256: string;
}
export type FrozenSnapshot = PlainFrozen | PackedFrozen;

export type UploadStatus = "accepted" | "duplicate_install" | "late";
export interface UploadRecord {
  status: UploadStatus;
  receivedAt: string | null;
  replay: boolean;
}

/** What the game shows (null: nothing to say). */
export type TransferView = "waiting" | "sent" | "late" | "tooLarge" | "unsupported" | null;

/** Compression and hashing (the browser's CompressionStream and Web Crypto; injected in tests). */
export interface Codec {
  gzip(bytes: Uint8Array): Promise<Uint8Array>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parse = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The browser's codec, or null when it cannot compress (an old browser: the save is kept, the person is told). */
export function browserCodec(): Codec | null {
  if (typeof CompressionStream === "undefined" || typeof crypto === "undefined" || !crypto.subtle) return null;
  return {
    async gzip(bytes) {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
    async sha256Hex(bytes) {
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
      return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function readUpload(kv: SpaceKV): UploadRecord | null {
  const r = parse<UploadRecord>(kv.get(UPLOAD_KEY));
  return r && ["accepted", "duplicate_install", "late"].includes(r.status) ? r : null;
}

export function transferViewOf(mode: EconomyMode, upload: UploadRecord | null, lastError: string | null): TransferView {
  if (upload) return upload.status === "late" ? "late" : "sent";
  if (lastError === "import_too_large" || lastError === "import_ratio" || lastError === "import_quota") return "tooLarge";
  if (lastError === "compression_unavailable") return "unsupported";
  return mode === "migration_pending" || mode === "cloud_active" ? "waiting" : null;
}

function installIdOf(kv: SpaceKV, uuid: () => string): string | null {
  const known = kv.get(INSTALL_KEY);
  if (known && UUID_RE.test(known)) return known;
  const id = uuid();
  return kv.set(INSTALL_KEY, id) ? id : null;
}

function readFrozen(kv: SpaceKV): FrozenSnapshot | null {
  const known = parse<Record<string, unknown>>(kv.get(SNAPSHOT_KEY));
  if (!known || typeof known.snapshotId !== "string" || !UUID_RE.test(known.snapshotId)) return null;
  if (known.encoding === "gzip") {
    return typeof known.stateGzip === "string" && typeof known.stateBytes === "number" && typeof known.stateSha256 === "string" ? (known as unknown as PackedFrozen) : null;
  }
  return known.state && typeof known.state === "object" && !Array.isArray(known.state) ? (known as unknown as PlainFrozen) : null;
}

/** The frozen copy: the one already written, or a new one of `rawState` (the saved game JSON) — never rewritten. */
export function freezeSnapshot(kv: SpaceKV, rawState: string | null, now: Date, uuid: () => string): FrozenSnapshot | null {
  const known = readFrozen(kv);
  if (known) return known;
  const state = parse<Record<string, unknown>>(rawState);
  if (!state || typeof state !== "object" || Array.isArray(state)) return null; // nothing saved here: nothing to send
  const frozen: PlainFrozen = { snapshotId: uuid(), frozenAt: now.toISOString(), state };
  return kv.set(SNAPSHOT_KEY, JSON.stringify(frozen)) ? frozen : null;
}

export type FreezeOutcome = { kind: "frozen"; frozen: FrozenSnapshot } | { kind: "nothing" } | { kind: "refused"; error: string };

/**
 * Q4.6: the frozen copy of a save of any size. Up to 1 MiB: freezeSnapshot, as before. Above: compressed once (the
 * exact stored JSON, its byte length and SHA-256), so the frozen copy fits next to the save in the browser storage.
 * Under a cross-tab lock when the browser has one: two tabs never freeze two different copies.
 */
export async function freezeLargeAware(kv: SpaceKV, rawState: string | null, now: Date, uuid: () => string, codec: Codec | null,
  lock?: <T>(fn: () => Promise<T>) => Promise<T>): Promise<FreezeOutcome> {
  const run = async (): Promise<FreezeOutcome> => {
    const known = readFrozen(kv);
    if (known) return { kind: "frozen", frozen: known };
    if (rawState === null) return { kind: "nothing" };
    const bytes = utf8(rawState);
    if (bytes.length <= PLAIN_MAX_BYTES) {
      const f = freezeSnapshot(kv, rawState, now, uuid);
      return f ? { kind: "frozen", frozen: f } : { kind: "nothing" };
    }
    const state = parse<Record<string, unknown>>(rawState);
    if (!state || typeof state !== "object" || Array.isArray(state)) return { kind: "nothing" };
    if (bytes.length > RAW_MAX_BYTES) return { kind: "refused", error: "import_too_large" };
    if (!codec) {
      // cannot compress here: keep the moment as it is when the storage has room (a newer browser sends it later)
      freezeSnapshot(kv, rawState, now, uuid);
      return { kind: "refused", error: "compression_unavailable" };
    }
    const gz = await codec.gzip(bytes);
    if (gz.length > GZIP_MAX_BYTES) return { kind: "refused", error: "import_too_large" };
    const packed: PackedFrozen = { snapshotId: uuid(), frozenAt: now.toISOString(), encoding: "gzip", stateGzip: toBase64(gz), stateBytes: bytes.length, stateSha256: await codec.sha256Hex(bytes) };
    // another tab may have frozen meanwhile (a browser without Web Locks): its copy wins, never two
    const again = readFrozen(kv);
    if (again) return { kind: "frozen", frozen: again };
    return kv.set(SNAPSHOT_KEY, JSON.stringify(packed)) ? { kind: "frozen", frozen: packed } : { kind: "nothing" };
  };
  return lock ? lock(run) : run();
}

/** The request body for a frozen copy (plain as before; compressed when large — the frozen copy itself never changes). */
export async function snapshotBody(frozen: FrozenSnapshot, installId: string, codec: Codec | null): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const base = { snapshotId: frozen.snapshotId, installId, schema: 1 };
  if ("encoding" in frozen) return { ok: true, body: { ...base, encoding: "gzip", stateGzip: frozen.stateGzip, stateBytes: frozen.stateBytes, stateSha256: frozen.stateSha256 } };
  const bytes = utf8(JSON.stringify(frozen.state));
  if (bytes.length <= PLAIN_MAX_BYTES) return { ok: true, body: { ...base, state: frozen.state } };
  // a large copy frozen before Q4.6 (or without compression): compressed for the request only
  if (bytes.length > RAW_MAX_BYTES) return { ok: false, error: "import_too_large" };
  if (!codec) return { ok: false, error: "compression_unavailable" };
  const gz = await codec.gzip(bytes);
  if (gz.length > GZIP_MAX_BYTES) return { ok: false, error: "import_too_large" };
  return { ok: true, body: { ...base, encoding: "gzip", stateGzip: toBase64(gz), stateBytes: bytes.length, stateSha256: await codec.sha256Hex(bytes) } };
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
  /** compression (undefined: the browser's; null: none) */
  codec?: Codec | null;
  /** a cross-tab lock for the freeze (the browser's Web Locks in the app) */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
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
  const codec = deps.codec === undefined ? browserCodec() : deps.codec;
  const frozen = await freezeLargeAware(deps.kv, deps.rawState, deps.now, deps.uuid, codec, deps.lock);
  if (frozen.kind === "refused") return { kind: "retry", error: frozen.error };
  const installId = installIdOf(deps.kv, deps.uuid);
  if (frozen.kind === "nothing" || !installId) return { kind: "nothing" };
  const body = await snapshotBody(frozen.frozen, installId, codec);
  if (!body.ok) return { kind: "retry", error: body.error };
  const send = deps.send ?? ((b: unknown, s: RequestScope) => callDayApi(SNAPSHOT_PATH, "POST", b, fetch, undefined, undefined, s));
  const r = await send(body.body, scope);
  if (!deps.belongs(scope, r.account)) return { kind: "ignored" };
  if (!r.ok) return { kind: "retry", error: r.error, ...(r.state ? { state: r.state } : {}) };
  const b = r.body as { status?: unknown; receivedAt?: unknown; replay?: unknown };
  if (b.status !== "accepted" && b.status !== "duplicate_install" && b.status !== "late") return { kind: "retry", error: "bad_response" };
  const record: UploadRecord = { status: b.status, receivedAt: typeof b.receivedAt === "string" ? b.receivedAt : null, replay: b.replay === true };
  deps.kv.set(UPLOAD_KEY, JSON.stringify(record));
  return { kind: "done", record };
}
