import { describe, expect, it, vi } from "vitest";
import { callDayApi } from "./server-day-client";

/** A fetch that answers from a list, and keeps what it was asked. */
function fetchOf(...answers: Array<[number, Record<string, unknown>]>) {
  const asked: Array<{ path: string; method?: string; body?: unknown }> = [];
  const impl = (async (path: string, init?: RequestInit) => {
    asked.push({ path, method: init?.method, body: init?.body });
    const [status, json] = answers[Math.min(asked.length - 1, answers.length - 1)];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, asked };
}
const STALE: [number, Record<string, unknown>] = [401, { error: "session_stale", state: "migration_pending", reason: "mark_changed" }];
const OK: [number, Record<string, unknown>] = [200, { status: { state: "cloud_active", game_sync: false, day: null } }];

describe("Q4.5-2 the app on session_stale: one refresh, one repeat, never a loop", () => {
  it("fresh at once: no refresh", async () => {
    const f = fetchOf(OK);
    const refresh = vi.fn(async () => true);
    const r = await callDayApi("/api/game/day/status", "GET", undefined, f.impl, refresh);
    expect(r).toMatchObject({ ok: true, status: { state: "cloud_active" } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stale, refreshed, repeated with the same body: the answer of the repeat", async () => {
    const f = fetchOf(STALE, OK);
    const refresh = vi.fn(async () => true);
    const r = await callDayApi("/api/game/day/accept", "POST", { mission: "m_lesson" }, f.impl, refresh);
    expect(r.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(f.asked).toHaveLength(2);
    expect(f.asked[0]).toEqual(f.asked[1]);
  });

  it("the refresh fails (offline, ended session): no repeat; the account's state from the refusal is kept", async () => {
    const f = fetchOf(STALE, OK);
    const r = await callDayApi("/api/game/day/status", "GET", undefined, f.impl, async () => false);
    expect(r).toEqual({ ok: false, error: "session_stale", httpStatus: 401, state: "migration_pending" });
    expect(f.asked).toHaveLength(1);
  });

  it("still stale after the refresh: one repeat only, the state kept", async () => {
    const f = fetchOf(STALE, [401, { error: "session_stale" }], OK);
    const refresh = vi.fn(async () => true);
    const r = await callDayApi("/api/game/day/status", "GET", undefined, f.impl, refresh);
    expect(r).toMatchObject({ ok: false, error: "session_stale", state: "migration_pending" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(f.asked).toHaveLength(2);
  });

  it("other refusals never refresh the session", async () => {
    for (const answer of [[401, { error: "not_signed_in" }], [409, { error: "account_not_active" }], [503, { error: "server_economy_unavailable" }]] as Array<[number, Record<string, unknown>]>) {
      const refresh = vi.fn(async () => true);
      const r = await callDayApi("/api/game/day/status", "GET", undefined, fetchOf(answer).impl, refresh);
      expect(r).toMatchObject({ ok: false, error: answer[1].error });
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it("an unknown state in a refusal is not taken", async () => {
    const r = await callDayApi("/api/game/day/status", "GET", undefined, fetchOf([401, { error: "session_stale", state: "admin" }]).impl, async () => false);
    expect(r).toEqual({ ok: false, error: "session_stale", httpStatus: 401 });
  });

  it("no network: an answer, never a throw; no refresh", async () => {
    const refresh = vi.fn(async () => true);
    const r = await callDayApi("/api/game/day/status", "GET", undefined, (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch, refresh);
    expect(r).toEqual({ ok: false, error: "network" });
    expect(refresh).not.toHaveBeenCalled();
  });
});
