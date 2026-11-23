import { describe, expect, it } from "vitest";
import type { DayApiDeps, Rpc } from "./day-api";
import { handleSnapshotApi, parseSnapshotBody } from "./migration-snapshot";
import { createRateLimiter } from "./rate-limit";

const ORIGIN = "https://ayra.test";
const A = "00000000-0000-0000-0000-00000000000a";
const S_A = "5e55e55e-0000-4000-8000-00000000000a";
const TOKEN_A = { sub: A, sessionId: S_A, iat: 1_763_600_000, claim: "migration_pending" as const };
const SNAP = "6f1c1e3a-2b4d-4c5e-8f60-718293a4b5c6";
const INST = "0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3";
const BODY = { snapshotId: SNAP, installId: INST, schema: 1, state: { level: 3, xp: 50, coins: 120 } };

function deps(over: Partial<DayApiDeps> & { calls?: Array<[string, Record<string, unknown>]>; answer?: { data: unknown; error: { code?: string; message?: string } | null } } = {}): DayApiDeps {
  const calls = over.calls ?? [];
  const rpc: Rpc = async (fn, args) => {
    calls.push([fn, args]);
    return over.answer ?? { data: { status: "accepted", replay: false, received_at: "2026-11-24T10:00:00Z" }, error: null };
  };
  return { enabled: true, getUser: async () => ({ id: A, token: TOKEN_A }), rpc, limiter: createRateLimiter({ limit: 10, windowMs: 60_000 }), now: () => new Date("2026-11-24T10:00:00Z"), origin: ORIGIN, ...over };
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/game/migration/snapshot`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("Q4.5-4 snapshot intake — who may send", () => {
  it("off unless switched on; signed out; another site; GET — never reaches the database", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect((await handleSnapshotApi(post(BODY), deps({ enabled: false, calls }))).status).toBe(404);
    expect((await handleSnapshotApi(post(BODY), deps({ getUser: async () => null, calls }))).status).toBe(401);
    expect((await handleSnapshotApi(post(BODY, { origin: "https://evil.example" }), deps({ calls }))).status).toBe(403);
    expect((await handleSnapshotApi(new Request(`${ORIGIN}/x`, { method: "GET" }), deps({ calls }))).status).toBe(405);
    expect(calls).toEqual([]);
  });
  it("a token of another user is stale (never sent to the database)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const out = await handleSnapshotApi(post(BODY), deps({ calls, getUser: async () => ({ id: A, token: { ...TOKEN_A, sub: "someone-else" } }) }));
    expect(out).toMatchObject({ status: 401, body: { error: "session_stale", reason: "session_revoked", account: A } });
    expect(calls).toEqual([]);
  });
});

describe("Q4.5-4 snapshot intake — the body", () => {
  it.each([
    ["a user id", { ...BODY, userId: A }],
    ["XP to credit", { ...BODY, xp: 100 }],
    ["no snapshot id", { ...BODY, snapshotId: undefined }],
    ["a snapshot id that is no random UUID", { ...BODY, snapshotId: "00000000-0000-0000-0000-000000000001" }],
    ["an install id that is no UUID", { ...BODY, installId: "phone" }],
    ["another schema", { ...BODY, schema: 2 }],
    ["a state that is a list", { ...BODY, state: [1] }],
  ])("refuses %s", (_name, body) => {
    expect(parseSnapshotBody(JSON.parse(JSON.stringify(body)))).toEqual({ ok: false, status: 400, error: "bad_request" });
  });
  it("a body above the limit is refused before the database", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const out = await handleSnapshotApi(post({ ...BODY, state: { pad: "x".repeat(1_100_000) } }), deps({ calls }));
    expect(out.status).toBe(413);
    expect(calls).toEqual([]);
  });
});

describe("Q4.5-4 snapshot intake — what is sent and answered", () => {
  it("the user and the token's claims are the session's; the state goes as it came", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const out = await handleSnapshotApi(post(BODY), deps({ calls }));
    expect(out).toMatchObject({ status: 200, body: { status: "accepted", replay: false, receivedAt: "2026-11-24T10:00:00Z", account: A } });
    expect(calls).toEqual([["game_import_snapshot", {
      p_user: A, p_session: S_A, p_iat: TOKEN_A.iat, p_claim: "migration_pending",
      p_snapshot: SNAP, p_install: INST, p_schema: 1, p_content: { level: 3, xp: 50, coins: 120 },
    }]]);
  });
  it.each([
    ["game_session_stale", 401, "session_stale"],
    ["game_import_not_open", 409, "import_not_open"],
    ["game_import_conflict", 409, "import_conflict"],
    ["game_import_too_large", 413, "import_too_large"],
    ["game_import_limit", 429, "import_limit"],
    ["something unexpected", 503, "server_error"],
  ])("database refusal %s → %i %s", async (message, status, error) => {
    const out = await handleSnapshotApi(post(BODY), deps({ answer: { data: null, error: { message } } }));
    expect(out).toMatchObject({ status, body: { error, account: A } });
  });
  it("an answer the route does not know is a server error, never a success", async () => {
    expect((await handleSnapshotApi(post(BODY), deps({ answer: { data: { status: "credited" }, error: null } }))).status).toBe(503);
  });
});

/* ------------------------------------------------------------------ Q4.6: one request for a large save */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { SNAPSHOT_MAX_REQUEST_BYTES, SNAPSHOT_RAW_MAX_BYTES } from "./migration-snapshot";

/** A synthetic heavy save (no real data): about `days` × 6 quests of history. */
function heavySave(days: number): Record<string, unknown> {
  const history = Array.from({ length: days * 6 }, (_, i) => ({ questId: `q_${i % 60}`, questTitle: "Запись сделки в журнал", category: "trading", xp: 40, coins: 10, completedAt: `2026-${String(1 + ((i / 180) | 0) % 12).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, at: "2026-01-01T09:00:00.000Z" }));
  return { level: 40, xp: 10, coins: 9000, history };
}
const packedBody = (text: string, over: Record<string, unknown> = {}) => {
  const raw = Buffer.from(text);
  return { snapshotId: SNAP, installId: INST, schema: 1, encoding: "gzip", stateGzip: gzipSync(raw).toString("base64"), stateBytes: raw.length, stateSha256: createHash("sha256").update(raw).digest("hex"), ...over };
};

describe("Q4.6 large snapshots — compressed, one request, hard limits", () => {
  it("a save above 1 MiB goes compressed and reaches the database as the same object it was", async () => {
    const save = heavySave(1200);
    const text = JSON.stringify(save);
    expect(Buffer.byteLength(text)).toBeGreaterThan(1024 * 1024);
    const calls: Array<[string, Record<string, unknown>]> = [];
    const out = await handleSnapshotApi(post(packedBody(text)), deps({ calls }));
    expect(out).toMatchObject({ status: 200, body: { status: "accepted" } });
    expect(calls[0][1].p_content).toEqual(save);
  });
  it("the same content plain or compressed gives the database the same arguments (a retry is a replay whatever the transport)", async () => {
    const plain: Array<[string, Record<string, unknown>]> = [];
    const packed: Array<[string, Record<string, unknown>]> = [];
    await handleSnapshotApi(post(BODY), deps({ calls: plain }));
    await handleSnapshotApi(post(packedBody(JSON.stringify(BODY.state))), deps({ calls: packed }));
    expect(packed).toEqual(plain);
  });
  it.each([
    ["corrupted compression", () => { const b = packedBody(JSON.stringify(heavySave(10))); const z = Buffer.from(b.stateGzip as string, "base64"); z[20] ^= 0xff; z[21] ^= 0xff; return { ...b, stateGzip: z.toString("base64") }; }, 400, "bad_encoding"],
    ["a wrong checksum", () => packedBody(JSON.stringify(heavySave(10)), { stateSha256: "0".repeat(64) }), 400, "bad_checksum"],
    ["a size that is not the unpacked one", () => { const b = packedBody(JSON.stringify(heavySave(10))); return { ...b, stateBytes: (b.stateBytes as number) - 1 }; }, 400, "bad_encoding"],
    ["a stated size above 4 MiB", () => packedBody(JSON.stringify(heavySave(10)), { stateBytes: SNAPSHOT_RAW_MAX_BYTES + 1 }), 413, "import_too_large"],
    ["not base64", () => packedBody("{}", { stateGzip: "@@@@" }), 400, "bad_encoding"],
    ["another encoding", () => packedBody("{}", { encoding: "br" }), 400, "bad_encoding"],
    ["a plain state next to a packed one", () => ({ ...packedBody("{}"), state: { level: 99 } }), 400, "bad_request"],
    ["compressed JSON that is a list", () => packedBody("[1,2]"), 400, "bad_request"],
    ["compressed bytes that are no UTF-8", () => { const raw = Buffer.from([0xff, 0xfe, 0x7b, 0x7d]); return { snapshotId: SNAP, installId: INST, schema: 1, encoding: "gzip", stateGzip: gzipSync(raw).toString("base64"), stateBytes: raw.length, stateSha256: createHash("sha256").update(raw).digest("hex") }; }, 400, "bad_encoding"],
  ])("refuses %s — before the database", async (_name, make, status, error) => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const out = await handleSnapshotApi(post(make()), deps({ calls }));
    expect(out).toMatchObject({ status, body: { error } });
    expect(calls).toEqual([]);
  });
  it("decompression bombs: a high stated ratio is refused before unpacking; a lying small size stops at the 4 MiB cap", async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 32)); // 8 MiB of spaces → about 8 KB
    const base = { snapshotId: SNAP, installId: INST, schema: 1, encoding: "gzip", stateGzip: bomb.toString("base64"), stateSha256: "a".repeat(64) };
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect(await handleSnapshotApi(post({ ...base, stateBytes: 4_000_000 }), deps({ calls }))).toMatchObject({ status: 413, body: { error: "import_ratio" } });
    expect(await handleSnapshotApi(post({ ...base, stateBytes: 100 }), deps({ calls }))).toMatchObject({ status: 413, body: { error: "import_too_large" } });
    expect(await handleSnapshotApi(post({ ...base, stateBytes: 8 * 1024 * 1024 }), deps({ calls }))).toMatchObject({ status: 413, body: { error: "import_too_large" } });
    // a moderately compressible state that unpacks beyond 4 MiB while claiming less: stopped at the cap
    const big = Buffer.from(JSON.stringify(heavySave(5200)));
    expect(big.length).toBeGreaterThan(SNAPSHOT_RAW_MAX_BYTES);
    const z = gzipSync(big);
    expect(await handleSnapshotApi(post({ ...base, stateGzip: z.toString("base64"), stateBytes: 4_000_000 }), deps({ calls }))).toMatchObject({ status: 413, body: { error: "import_too_large" } });
    expect(calls).toEqual([]);
  });
  it("the request is read with a cap: a declared or streamed body above it is refused without reading it all", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect((await handleSnapshotApi(post(BODY, { "content-length": String(SNAPSHOT_MAX_REQUEST_BYTES + 1) }), deps({ calls }))).status).toBe(413);
    expect((await handleSnapshotApi(post(JSON.stringify({ ...BODY, pad: "x".repeat(SNAPSHOT_MAX_REQUEST_BYTES) })), deps({ calls }))).status).toBe(413);
    expect(calls).toEqual([]);
  });
});
