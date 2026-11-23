/**
 * Q4.5-4 — receiving a device snapshot for the transfer to the server economy (docs/q4-5-4-migration-provenance-audit.md).
 *   POST /api/game/migration/snapshot   { snapshotId, installId, schema: 1, state }
 * The snapshot goes to quarantine (game_import_snapshot, 0019) as it came: nothing is credited, the account is not moved.
 * The user is the verified session's; the token's claims go with it and the database checks them against the state now
 * (a token issued before the transfer window is refused). The install id is a random id of the device's storage — it
 * groups snapshots, it proves nothing about a device.
 */
import { forAccount, gate, readJson, refusalOf, reply, type ApiHttp, type DayApiDeps } from "./day-api";

export const SNAPSHOT_API_RATE = { limit: 10, windowMs: 60_000 };
/** PLACEHOLDER: the largest snapshot body (the database refuses a content above 1 MB on its own). */
export const SNAPSHOT_MAX_BODY_BYTES = 1024 * 1024 + 4 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Refusals of 0019 (anything else falls back to the shared ones). */
const SNAPSHOT_REFUSALS: Record<string, number> = {
  game_import_not_open: 409,
  game_import_conflict: 409,
  game_import_schema: 400,
  game_import_too_large: 413,
  game_import_limit: 429,
  game_bad_request: 400,
  game_session_stale: 401,
};

export function parseSnapshotBody(body: unknown): { ok: true; args: Record<string, unknown> } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (!Object.keys(b).every((k) => ["snapshotId", "installId", "schema", "state"].includes(k))) return { ok: false };
  if (typeof b.snapshotId !== "string" || !UUID_RE.test(b.snapshotId)) return { ok: false };
  if (typeof b.installId !== "string" || !UUID_RE.test(b.installId)) return { ok: false };
  if (b.schema !== 1) return { ok: false };
  if (!b.state || typeof b.state !== "object" || Array.isArray(b.state)) return { ok: false };
  return { ok: true, args: { p_snapshot: b.snapshotId.toLowerCase(), p_install: b.installId.toLowerCase(), p_schema: 1, p_content: b.state } };
}

export async function handleSnapshotApi(req: Request, deps: DayApiDeps): Promise<ApiHttp> {
  const g = await gate(req, deps, false);
  if ("refused" in g) return g.refused;
  const user = g.user;
  const json = await readJson(req, SNAPSHOT_MAX_BODY_BYTES);
  if (!json.ok) return forAccount(json.http, user.id);
  const parsed = parseSnapshotBody(json.body);
  if (!parsed.ok) return forAccount(reply(400, { error: "bad_request" }), user.id);
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
