import { describe, expect, it } from "vitest";
import { handleDayApi, parseDayBody, refusalOf, type DayApiDeps, type Rpc } from "./day-api";
import { createRateLimiter } from "./rate-limit";

const ORIGIN = "https://ayra.test";
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const STATUS = { state: "cloud_active", game_sync: false, game_day: "2026-11-20", day: { game_day: "2026-11-20", mode: "trading", core: ["q_bias"] } };

function deps(over: Partial<DayApiDeps> & { calls?: Array<[string, Record<string, unknown>]> } = {}): DayApiDeps {
  const calls = over.calls ?? [];
  const rpc: Rpc = async (fn, args) => {
    calls.push([fn, args]);
    if (fn === "game_day_status") return { data: STATUS, error: null };
    return { data: { ok: true }, error: null };
  };
  return { enabled: true, getUser: async () => ({ id: A }), rpc, limiter: createRateLimiter({ limit: 60, windowMs: 60_000 }), now: () => new Date("2026-11-20T10:00:00Z"), origin: ORIGIN, ...over };
}
const post = (action: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/game/day/${action}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (action = "status") => new Request(`${ORIGIN}/api/game/day/${action}`, { method: "GET" });

describe("Q4.4 day API — who may ask", () => {
  it("off unless switched on (404); unknown action (404)", async () => {
    expect((await handleDayApi(get(), "status", deps({ enabled: false }))).status).toBe(404);
    expect((await handleDayApi(post("payout", {}), "payout", deps())).status).toBe(404);
  });
  it("no session: 401 — the request never reaches the database", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect((await handleDayApi(get(), "status", deps({ getUser: async () => null, calls }))).status).toBe(401);
    expect((await handleDayApi(post("accept", { mission: "q_bias" }), "accept", deps({ getUser: async () => { throw new Error("jwt expired"); }, calls }))).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("another site, no origin, not JSON, GET for a change: refused", async () => {
    expect((await handleDayApi(post("accept", { mission: "q_bias" }, { origin: "https://evil.example" }), "accept", deps())).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await handleDayApi(noOrigin, "accept", deps())).status).toBe(403);
    expect((await handleDayApi(post("accept", { mission: "q_bias" }, { "content-type": "text/plain" }), "accept", deps())).status).toBe(415);
    expect((await handleDayApi(get("accept"), "accept", deps())).status).toBe(405);
  });
  it("rate limit per account", async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const d = deps({ limiter });
    expect((await handleDayApi(get(), "status", d)).status).toBe(200);
    expect((await handleDayApi(get(), "status", d)).status).toBe(200);
    const over = await handleDayApi(get(), "status", d);
    expect(over.status).toBe(429);
    expect(over.headers["Retry-After"]).toBeDefined();
    expect((await handleDayApi(get(), "status", deps({ limiter, getUser: async () => ({ id: B }) }))).status).toBe(200);
  });
});

describe("Q4.4 day API — nothing the client says decides who, when or which mode", () => {
  it.each([
    ["a user id", "accept", { mission: "q_bias", user_id: B }],
    ["a game day", "accept", { mission: "q_bias", day: "2026-11-21" }],
    ["a device time", "pass", { mission: "q_bias", now: "2026-11-21T00:00:00Z" }],
    ["an opening mode", "open", { extras: [], mode: "recovery" }],
    ["three extras", "open", { extras: ["q_walk", "q_meditate", "q_gym"] }],
    ["an unknown mode", "mode", { mode: "holiday" }],
    ["an amount", "accept", { mission: "q_bias", xp: 40 }],
    ["a bad mission id", "accept", { mission: "Q BIAS" }],
    ["bad trading days", "trading-days", { days: [1, 9] }],
    ["no trading days", "trading-days", { days: [] }],
  ])("refuses %s (400)", async (_n, action, body) => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const r = await handleDayApi(post(action, body), action, deps({ calls }));
    expect(r).toMatchObject({ status: 400, body: { error: "bad_request" } });
    expect(calls).toEqual([]);
  });

  it("the user is always the session's; the server time is the database's (no time is passed)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    await handleDayApi(post("accept", { mission: "q_bias" }), "accept", deps({ calls }));
    await handleDayApi(post("open", { extras: ["q_walk"] }), "open", deps({ calls }));
    await handleDayApi(post("mode", { mode: "rest" }), "mode", deps({ calls }));
    await handleDayApi(post("trading-days", { days: [3, 0, 0, 1] }), "trading-days", deps({ calls }));
    const writes = calls.filter(([fn]) => fn !== "game_day_status");
    expect(writes).toEqual([
      ["game_day_accept", { p_user: A, p_mission: "q_bias" }],
      ["game_day_open", { p_user: A, p_bonus: ["q_walk"] }],
      ["game_day_set_mode", { p_user: A, p_mode: "rest", p_bonus: null }],
      ["game_set_trading_days", { p_user: A, p_days: [0, 1, 3] }],
    ]);
    for (const [, args] of calls) expect(Object.keys(args).some((k) => /now|time|day$/.test(k))).toBe(false);
  });

  it("a change answers with the fresh status of the day", async () => {
    const r = await handleDayApi(post("accept", { mission: "q_bias" }), "accept", deps());
    expect(r.status).toBe(200);
    expect(r.body.status).toEqual(STATUS);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });
});

describe("Q4.4 day API — refusals are codes", () => {
  const refusing = (message: string, code?: string): Rpc => async (fn) => (fn === "game_day_status" ? { data: STATUS, error: null } : { data: null, error: { message, code } });
  it.each([
    ["game_mission_not_assigned", 409, "mission_not_assigned"],
    ["game_day_not_open", 409, "day_not_open"],
    ["game_replacement_limit", 409, "replacement_limit"],
    ["game_bad_extras", 400, "bad_extras"],
    ["game_account_not_active", 409, "account_not_active"],
    ["game_day_closed", 409, "day_closed"],
  ])("%s → %i %s", async (msg, status, reason) => {
    const r = await handleDayApi(post("accept", { mission: "q_bias" }), "accept", deps({ rpc: refusing(msg) }));
    expect(r).toMatchObject({ status, body: { error: reason } });
  });

  it("the server economy not installed (0014–0016 not applied on the real Supabase): 503 server_economy_unavailable", async () => {
    const r = await handleDayApi(get(), "status", deps({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.game_day_status(p_user) in the schema cache" } }) }));
    expect(r).toMatchObject({ status: 503, body: { error: "server_economy_unavailable" } });
    expect(refusalOf({ code: "42883", message: "function public.game_day_open does not exist" }).reason).toBe("server_economy_unavailable");
  });

  it("an unknown database error or a dropped connection: a bare code, no message, no user id", async () => {
    const leak = await handleDayApi(post("accept", { mission: "q_bias" }), "accept", deps({ rpc: refusing("permission denied for table game_days on db.internal:5432") }));
    expect(leak).toMatchObject({ status: 503, body: { error: "server_error" } });
    const down = await handleDayApi(post("accept", { mission: "q_bias" }), "accept", deps({ rpc: async () => { throw new Error("ECONNRESET 10.0.0.5"); } }));
    expect(down).toMatchObject({ status: 503, body: { error: "server_error" } });
    for (const r of [leak, down]) for (const s of ["db.internal", "10.0.0.5", "permission", A]) expect(JSON.stringify(r)).not.toContain(s);
  });
});

describe("Q4.4 day API — strict bodies", () => {
  it("accepts the documented shapes only", () => {
    expect(parseDayBody("open", {})).toEqual({ ok: true, args: { p_bonus: [] } });
    expect(parseDayBody("mode", { mode: "study", extras: ["q_read_pages"] })).toEqual({ ok: true, args: { p_mode: "study", p_bonus: ["q_read_pages"] } });
    expect(parseDayBody("replace", { from: "q_walk", to: "q_meditate" })).toEqual({ ok: true, args: { p_from: "q_walk", p_to: "q_meditate" } });
    expect(parseDayBody("replace", { from: "q_walk" })).toEqual({ ok: false });
    expect(parseDayBody("open", [])).toEqual({ ok: false });
  });
});
