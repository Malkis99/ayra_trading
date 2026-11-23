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
    expect(parseSnapshotBody(JSON.parse(JSON.stringify(body)))).toEqual({ ok: false });
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
