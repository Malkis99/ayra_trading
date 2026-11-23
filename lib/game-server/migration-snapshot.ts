/**
 * Q4.5-4 — receiving a device snapshot for the transfer to the server economy (docs/q4-5-4-migration-provenance-audit.md).
 *   POST /api/game/migration/snapshot   { snapshotId, installId, schema: 1, state }
 *                                        { snapshotId, installId, schema: 1, encoding: "gzip", stateGzip, stateBytes, stateSha256 }
 * The snapshot goes to quarantine (game_import_snapshot, 0019/0020) as it came: nothing is credited, the account is not
 * moved. The user is the verified session's; the token's claims go with it and the database checks them against the
 * state now (a token issued before the transfer window is refused). The install id is a random id of the device's
 * storage — it groups snapshots, it proves nothing about a device.
 *
 * Q4.6 (docs/q4-6-achievements-migration.md, «Большие снимки») — the same route, one request, for a save above 1 MiB:
 * gzip of the exact saved JSON. Hard limits, all checked before anything reaches the database, nothing kept on a
 * refusal: the body is read with a cap (never the whole request first); at most 1 MiB compressed; unpacked with a cap of
 * 4 MiB (Node stops and throws at the cap — never an unbounded buffer); the unpacked size must be the stated one, the
 * compression ratio at most 50 (synthetic saves compress about 20×), the SHA-256 the stated one, the text valid UTF-8
 * JSON of an object. Then it is the same content as an uncompressed snapshot: the database's md5 of the content makes a
 * retry a replay whatever the transport.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { forAccount, gate, refusalOf, reply, type ApiHttp, type DayApiDeps } from "./day-api";

export const SNAPSHOT_API_RATE = { limit: 10, windowMs: 60_000 };
/** PLACEHOLDER: the largest uncompressed snapshot body (Q4.5-4, unchanged). */
export const SNAPSHOT_MAX_BODY_BYTES = 1024 * 1024 + 4 * 1024;
/** Q4.6: the largest compressed state (bytes before base64). */
export const SNAPSHOT_GZIP_MAX_BYTES = 1024 * 1024;
/** Q4.6: the largest state after unpacking (measured: 5 years × 10 quests a day ≈ 3.5 MB; the database's limit too). */
export const SNAPSHOT_RAW_MAX_BYTES = 4 * 1024 * 1024;
/** Q4.6: unpacked ÷ compressed at most (synthetic saves: 18–23×; a decompression bomb: about 1000×). */
export const SNAPSHOT_MAX_RATIO = 50;
/** The largest request at all: the compressed state in base64 plus the envelope. */
export const SNAPSHOT_MAX_REQUEST_BYTES = Math.ceil(SNAPSHOT_GZIP_MAX_BYTES / 3) * 4 + 4 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Refusals of 0019/0020 (anything else falls back to the shared ones). */
const SNAPSHOT_REFUSALS: Record<string, number> = {
  game_import_not_open: 409,
  game_import_conflict: 409,
  game_import_schema: 400,
  game_import_too_large: 413,
  game_import_limit: 429,
  game_import_quota: 413,
  game_bad_request: 400,
  game_session_stale: 401,
};

type Parsed = { ok: true; args: Record<string, unknown> } | { ok: false; status: number; error: string };
const bad = (status: number, error: string): Parsed => ({ ok: false, status, error });

/** Reads the body with a cap: the declared length first, then the stream — never more than `max` bytes in memory. */
export async function readCapped(req: Request, max: number): Promise<{ ok: true; text: string; bytes: number } | { ok: false; http: ApiHttp }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { ok: false, http: reply(413, { error: "too_large" }) };
  if (!req.body) return { ok: true, text: "", bytes: 0 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, http: reply(413, { error: "too_large" }) };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(all), bytes };
  } catch {
    return { ok: false, http: reply(400, { error: "bad_request" }) };
  }
}

/** The packed state → the saved JSON object, or why not (nothing partial is ever returned). */
export function unpackState(stateGzip: unknown, stateBytes: unknown, stateSha256: unknown): { ok: true; state: Record<string, unknown> } | { ok: false; status: number; error: string } {
  if (typeof stateGzip !== "string" || !BASE64_RE.test(stateGzip) || stateGzip.length % 4 !== 0) return { ok: false, status: 400, error: "bad_encoding" };
  if (typeof stateBytes !== "number" || !Number.isInteger(stateBytes) || stateBytes < 1) return { ok: false, status: 400, error: "bad_request" };
  if (typeof stateSha256 !== "string" || !SHA256_RE.test(stateSha256)) return { ok: false, status: 400, error: "bad_request" };
  if (stateBytes > SNAPSHOT_RAW_MAX_BYTES) return { ok: false, status: 413, error: "import_too_large" };
  const packed = Buffer.from(stateGzip, "base64");
  if (packed.length === 0 || packed.length > SNAPSHOT_GZIP_MAX_BYTES) return { ok: false, status: 413, error: "import_too_large" };
  // the stated size is checked against the ratio before unpacking a byte
  if (stateBytes / packed.length > SNAPSHOT_MAX_RATIO) return { ok: false, status: 413, error: "import_ratio" };
  let raw: Buffer;
  try {
    // Node stops at maxOutputLength and throws (ERR_BUFFER_TOO_LARGE): never more than the cap in memory
    raw = gunzipSync(packed, { maxOutputLength: SNAPSHOT_RAW_MAX_BYTES });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError) return { ok: false, status: 413, error: "import_too_large" };
    return { ok: false, status: 400, error: "bad_encoding" };
  }
  if (raw.length !== stateBytes) return { ok: false, status: 400, error: "bad_encoding" };
  if (raw.length / packed.length > SNAPSHOT_MAX_RATIO) return { ok: false, status: 413, error: "import_ratio" };
  if (createHash("sha256").update(raw).digest("hex") !== stateSha256) return { ok: false, status: 400, error: "bad_checksum" };
  let state: unknown;
  try {
    state = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return { ok: false, status: 400, error: "bad_encoding" };
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) return { ok: false, status: 400, error: "bad_request" };
  return { ok: true, state: state as Record<string, unknown> };
}

const PLAIN_KEYS = ["snapshotId", "installId", "schema", "state"];
const PACKED_KEYS = ["snapshotId", "installId", "schema", "encoding", "stateGzip", "stateBytes", "stateSha256"];

/** The body → the database's arguments. `bytes`: the request's size (an uncompressed body keeps the Q4.5-4 limit). */
export function parseSnapshotBody(body: unknown, bytes = 0): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad(400, "bad_request");
  const b = body as Record<string, unknown>;
  const packed = b.encoding !== undefined;
  if (!Object.keys(b).every((k) => (packed ? PACKED_KEYS : PLAIN_KEYS).includes(k))) return bad(400, "bad_request");
  if (typeof b.snapshotId !== "string" || !UUID_RE.test(b.snapshotId)) return bad(400, "bad_request");
  if (typeof b.installId !== "string" || !UUID_RE.test(b.installId)) return bad(400, "bad_request");
  if (b.schema !== 1) return bad(400, "bad_request");
  let state: unknown = b.state;
  if (packed) {
    if (b.encoding !== "gzip") return bad(400, "bad_encoding");
    const u = unpackState(b.stateGzip, b.stateBytes, b.stateSha256);
    if (!u.ok) return u;
    state = u.state;
  } else if (bytes > SNAPSHOT_MAX_BODY_BYTES) {
    return bad(413, "too_large");
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) return bad(400, "bad_request");
  return { ok: true, args: { p_snapshot: b.snapshotId.toLowerCase(), p_install: b.installId.toLowerCase(), p_schema: 1, p_content: state } };
}

export async function handleSnapshotApi(req: Request, deps: DayApiDeps): Promise<ApiHttp> {
  const g = await gate(req, deps, false);
  if ("refused" in g) return g.refused;
  const user = g.user;
  const read = await readCapped(req, SNAPSHOT_MAX_REQUEST_BYTES);
  if (!read.ok) return forAccount(read.http, user.id);
  let body: unknown;
  try {
    body = read.text ? JSON.parse(read.text) : {};
  } catch {
    return forAccount(reply(400, { error: "bad_request" }), user.id);
  }
  const parsed = parseSnapshotBody(body, read.bytes);
  if (!parsed.ok) return forAccount(reply(parsed.status, { error: parsed.error }), user.id);
  if (user.token.sub !== user.id) return forAccount(reply(401, { error: "session_stale", reason: "session_revoked" }), user.id);
  try {
    // the user and the token's claims are the session's, always — added here after the body was checked
    const { data, error } = await deps.rpc("game_import_snapshot", {
      p_user: user.id,
      p_session: user.token.sessionId,
      p_iat: user.token.iat,
      p_claim: user.token.claim,
      ...parsed.args,
    });
    if (error) {
      const msg = (error.message || "").trim();
      if (Object.prototype.hasOwnProperty.call(SNAPSHOT_REFUSALS, msg)) {
        const reason = msg === "game_session_stale" ? "session_stale" : msg.replace(/^game_/, "");
        return forAccount(reply(SNAPSHOT_REFUSALS[msg], { error: reason }), user.id);
      }
      const r = refusalOf(error);
      return forAccount(reply(r.status, { error: r.reason }), user.id);
    }
    const d = (data ?? {}) as { status?: unknown; replay?: unknown; received_at?: unknown };
    const status = ["accepted", "duplicate_install", "late"].includes(d.status as string) ? (d.status as string) : null;
    if (!status) return forAccount(reply(503, { error: "server_error" }), user.id);
    return forAccount(reply(200, { status, replay: d.replay === true, receivedAt: typeof d.received_at === "string" ? d.received_at : null }), user.id);
  } catch {
    return forAccount(reply(503, { error: "server_error" }), user.id);
  }
}
