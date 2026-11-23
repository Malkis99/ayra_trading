import { describe, expect, it } from "vitest";
import type { DayApiDeps, Rpc } from "./day-api";
import { handleAchievementsApi, readAchievements } from "./achievements-api";
import { createRateLimiter } from "./rate-limit";

const ORIGIN = "https://ayra.test";
const A = "00000000-0000-0000-0000-00000000000a";
const TOKEN_A = { sub: A, sessionId: "5e55e55e-0000-4000-8000-00000000000a", iat: 1_763_600_000, claim: "cloud_active" as const };
const ANSWER = {
  state: "cloud_active",
  transferred: true,
  achievements: [
    { id: "firstQuest", family: "profile", status: "verified", detail: {}, recordedAt: "2026-12-01T10:00:00Z" },
    { id: "author", family: "profile", status: "pending_review", detail: {}, recordedAt: "2026-12-01T10:00:00Z" },
    { id: "category:trading", family: "category", status: "verified", detail: { rank: "silver" }, recordedAt: "2026-12-01T10:00:00Z" },
  ],
};

function deps(over: Partial<DayApiDeps> & { calls?: Array<[string, Record<string, unknown>]>; answer?: { data: unknown; error: { message?: string } | null } } = {}): DayApiDeps {
  const calls = over.calls ?? [];
  const rpc: Rpc = async (fn, args) => {
    calls.push([fn, args]);
    return over.answer ?? { data: ANSWER, error: null };
  };
  return { enabled: true, getUser: async () => ({ id: A, token: TOKEN_A }), rpc, limiter: createRateLimiter({ limit: 30, windowMs: 60_000 }), now: () => new Date("2026-12-01T10:00:00Z"), origin: ORIGIN, ...over };
}
const get = () => new Request(`${ORIGIN}/api/game/achievements`, { method: "GET" });

describe("Q4.6 achievements — read only, the session's own", () => {
  it("off unless switched on; signed out; anything but GET — the database is never asked", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect((await handleAchievementsApi(get(), deps({ enabled: false, calls }))).status).toBe(404);
    expect((await handleAchievementsApi(get(), deps({ getUser: async () => null, calls }))).status).toBe(401);
    const post = new Request(`${ORIGIN}/api/game/achievements`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ id: "level3", status: "verified" }) });
    expect((await handleAchievementsApi(post, deps({ calls }))).status).toBe(405);
    expect(calls).toEqual([]);
  });
  it("the user and the token's claims are the session's — no achievement id or status is ever taken from a request", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const out = await handleAchievementsApi(get(), deps({ calls }));
    expect(calls).toEqual([["game_achievements_for_session", { p_user: A, p_session: TOKEN_A.sessionId, p_iat: TOKEN_A.iat, p_claim: "cloud_active" }]]);
    expect(out).toMatchObject({ status: 200, body: { state: "cloud_active", transferred: true, account: A } });
    expect((out.body.achievements as unknown[]).length).toBe(3);
  });
  it("a stale session → 401 session_stale (the app refreshes); a token of another user is never sent", async () => {
    expect(await handleAchievementsApi(get(), deps({ answer: { data: null, error: { message: "game_session_stale" } } }))).toMatchObject({ status: 401, body: { error: "session_stale", account: A } });
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect((await handleAchievementsApi(get(), deps({ calls, getUser: async () => ({ id: A, token: { ...TOKEN_A, sub: "else" } }) }))).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("only well-formed items are passed on; an unknown answer is a server error", () => {
    expect(readAchievements({ ...ANSWER, achievements: [...ANSWER.achievements, { id: "x", family: "profile", status: "unlocked" }, { id: 5 }] })?.achievements).toHaveLength(3);
    expect(readAchievements({ state: "nonsense", achievements: [] })).toBeNull();
    expect(readAchievements(null)).toBeNull();
  });
});
