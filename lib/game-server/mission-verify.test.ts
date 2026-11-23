import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { handleMissionVerify, traceOk, type CheckRow, type VerifyDeps } from "./mission-verify";
import { createRateLimiter } from "./rate-limit";
import type { Rpc } from "./day-api";

const ORIGIN = "https://ayra.test";
const A = "00000000-0000-0000-0000-00000000000a";
const TOKEN_A = { sub: A, sessionId: "5e55e55e-0000-4000-8000-00000000000a", iat: 1_763_600_000, claim: "cloud_active" as const };
const DAY = "2026-11-20";
const LESSON = "Урок дня: вход только после закрытия свечи над уровнем, без догоняния цены и без лишних сделок.";
const md5 = (d: unknown) => createHash("md5").update(JSON.stringify(d)).digest("hex");

const note = (id: string, over: Partial<CheckRow> = {}, data: Record<string, unknown> = {}): CheckRow => {
  const d = { id, templateKey: "lesson", body: LESSON + " " + id, createdAt: "2026-11-20T08:00:00Z", updatedAt: "2026-11-20T08:00:00Z", ...data };
  return { id, data: d, updated_at: "2026-11-20T08:00:05Z", client_updated_at: String(d.updatedAt), deleted_at: null, first_seen_at: "2026-11-20T08:00:05Z", fp: md5(d), ...over };
};
const status = (over: Record<string, unknown> = {}, day: Record<string, unknown> = {}) => ({
  state: "cloud_active",
  game_sync: true,
  game_day: DAY,
  day_full: false,
  day: { game_day: DAY, mode: "study", core: ["m_observation", "m_backtest", "m_lesson"], accepted: { m_lesson: "2026-11-20T07:00:00Z" }, paid: [], timezone: "UTC", ...day },
  ...over,
});

function deps(opts: { st?: unknown; notes?: CheckRow[]; payouts?: boolean; apply?: (args: Record<string, unknown>, n: number) => { data: unknown; error: { message: string } | null }; calls?: Array<[string, Record<string, unknown>]>; session?: unknown } = {}): VerifyDeps {
  const calls = opts.calls ?? [];
  let applies = 0;
  const rpc: Rpc = async (fn, args) => {
    calls.push([fn, args]);
    if (fn === "game_session_check") return { data: opts.session ?? { fresh: true, state: "cloud_active", reason: null }, error: null };
    if (fn === "game_day_status") return { data: opts.st ?? status(), error: null };
    if (fn === "game_journal_for_check") {
      const notes = opts.notes ?? [note("n1")];
      return { data: { notes, trades: [], plans: [], rows: notes.length }, error: null };
    }
    if (fn === "game_apply_reward_for_session") return opts.apply ? opts.apply(args, applies++) : { data: null, error: { message: "game_kind_disabled" } };
    return { data: null, error: { message: "unexpected" } };
  };
  return {
    enabled: true,
    payoutsEnabled: opts.payouts ?? false,
    getUser: async () => ({ id: A, token: TOKEN_A }),
    rpc,
    limiter: createRateLimiter({ limit: 60, windowMs: 60_000 }),
    now: () => new Date("2026-11-20T10:00:00Z"),
    origin: ORIGIN,
  };
}
const post = (body: unknown) => new Request(`${ORIGIN}/api/game/missions/verify`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const verify = (d: VerifyDeps, mission = "m_lesson") => handleMissionVerify(post({ mission }), d);

describe("Q4.4 mission verify — the server day first", () => {
  it.each([
    ["a local account", status({ state: "local", day: null }), "account_not_active"],
    ["a migrating account", status({ state: "migration_pending", day: null }), "account_not_active"],
    ["no open day", status({ day: null }), "day_not_open"],
    ["another mode's mission", status({}, { mode: "trading", core: ["q_bias", "q_riskcheck", "q_reflect"] }), "mission_not_assigned"],
    ["a rest day", status({}, { mode: "rest" }), "mission_not_assigned"],
    ["not accepted", status({}, { accepted: {} }), "mission_not_accepted"],
    ["already paid", status({}, { paid: ["m_lesson"] }), "mission_paid"],
    ["a full day", status({ day_full: true }), "day_cap"],
    ["game_sync off (paused)", status({ game_sync: false }), "sync_paused"],
  ])("%s → refused, the Journal is not even read", async (_n, st, reason) => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const r = await verify(deps({ st, calls }));
    expect(r).toMatchObject({ status: 409, body: { error: reason } });
    expect(calls.map(([fn]) => fn)).toEqual(["game_session_check", "game_day_status"]);
  });

  it("only a known mission, only the mission field", async () => {
    expect((await handleMissionVerify(post({ mission: "m_free_xp" }), deps())).status).toBe(400);
    expect((await handleMissionVerify(post({ mission: "m_lesson", user_id: "x" }), deps())).status).toBe(400);
  });
});

describe("Q4.4 mission verify — the content by the mission's rules, on the server's day", () => {
  it("a suitable record: fully checked, and payouts are off — nothing paid, the award is not called", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const r = await verify(deps({ calls }));
    expect(r).toMatchObject({ status: 200, body: { paid: false, confirmed: true, reason: "payout_disabled" } });
    expect(calls.some(([fn]) => fn.startsWith("game_apply_reward"))).toBe(false);
  });

  it("a wrong or unconfirmed record: short text, a copy, imported, another template, deleted", async () => {
    const cases: Array<[CheckRow[], string]> = [
      [[note("n1", {}, { body: "Коротко." })], "noteShort"],
      [[note("n0", { first_seen_at: "2026-11-10T08:00:00Z", updated_at: "2026-11-10T08:00:00Z" }, { body: LESSON, createdAt: "2026-11-10T08:00:00Z", updatedAt: "2026-11-10T08:00:00Z" }), note("n1", {}, { body: LESSON })], "noteCopy"],
      [[note("n1", {}, { importBatchId: "imp_1" })], "noteImported"],
      [[note("n1", {}, { templateKey: "idea" })], "noteMissing"],
      [[note("n1", { deleted_at: "2026-11-20T09:00:00Z" })], "noteMissing"],
    ];
    for (const [notes, reason] of cases) {
      const r = await verify(deps({ notes, payouts: true }));
      expect(r.body, reason).toMatchObject({ paid: false, confirmed: false, reason });
    }
  });

  it("the server trace: a note that first reached the server yesterday, or before 0016, does not count today", async () => {
    for (const first of ["2026-11-19T23:00:00Z", null]) {
      const r = await verify(deps({ notes: [note("n1", { first_seen_at: first })], payouts: true }));
      expect(r.body).toMatchObject({ paid: false, confirmed: false, reason: "not_seen_by_server" });
    }
    // and a record stamped later than the server's write of it
    const later = await verify(deps({ notes: [note("n1", { updated_at: "2026-11-20T07:00:00Z" })], payouts: true }));
    expect(later.body).toMatchObject({ confirmed: false });
  });
});

describe("Q4.4 mission verify — consistent with game_apply_reward (only when payouts are switched on)", () => {
  it("passes exactly the Postgres version and md5 fingerprint of the checked row", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const n = note("n1");
    const r = await verify(deps({ notes: [n], payouts: true, calls, apply: () => ({ data: { xp: 40, coins: 10 }, error: null }) }));
    expect(r).toMatchObject({ status: 200, body: { paid: true, confirmed: true } });
    const apply = calls.find(([fn]) => fn === "game_apply_reward_for_session")!;
    expect(apply[1]).toEqual({ p_user: A, p_session: TOKEN_A.sessionId, p_iat: TOKEN_A.iat, p_claim: "cloud_active", p_kind: "mission", p_item: "m_lesson", p_evidence: [{ table: "journal_notes", id: "n1", version: n.client_updated_at, fp: n.fp }] });
  });

  it("a record that already paid another mission: the next suitable record is tried", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const r = await verify(deps({
      notes: [note("n1"), note("n2", { first_seen_at: "2026-11-20T08:30:00Z", updated_at: "2026-11-20T08:30:00Z" }, { createdAt: "2026-11-20T08:30:00Z", updatedAt: "2026-11-20T08:30:00Z" })],
      payouts: true,
      calls,
      apply: (_a, i) => (i === 0 ? { data: null, error: { message: "game_source_used" } } : { data: { xp: 40 }, error: null }),
    }));
    expect(r.body).toMatchObject({ paid: true });
    expect(calls.filter(([fn]) => fn === "game_apply_reward_for_session").map(([, a]) => (a.p_evidence as Array<{ id: string }>)[0].id)).toEqual(["n1", "n2"]);
  });

  it("the database still refuses while the award kind is disabled; a record changed meanwhile is refused", async () => {
    expect((await verify(deps({ payouts: true }))).body).toMatchObject({ paid: false, confirmed: true, reason: "payout_disabled" });
    const changed = await verify(deps({ payouts: true, apply: () => ({ data: null, error: { message: "game_evidence_changed" } }) }));
    expect(changed).toMatchObject({ status: 409, body: { error: "evidence_changed" } });
  });
});

describe("Q4.4 server trace rule", () => {
  const row = (first: string | null, saved: string, data: Record<string, unknown> = {}): CheckRow => ({ id: "x", data, updated_at: saved, client_updated_at: saved, deleted_at: null, first_seen_at: first, fp: "f" });
  it("created-today sources need the first trace today; updated-today sources need a save today", () => {
    expect(traceOk("note:x", row("2026-11-20T01:00:00Z", "2026-11-20T01:00:00Z"), "UTC", DAY)).toBe(true);
    expect(traceOk("note:x", row("2026-11-19T23:00:00Z", "2026-11-20T01:00:00Z"), "UTC", DAY)).toBe(false);
    expect(traceOk("trade:x:review", row("2026-11-01T01:00:00Z", "2026-11-20T09:00:00Z"), "UTC", DAY)).toBe(true);
    expect(traceOk("trade:x:review", row("2026-11-01T01:00:00Z", "2026-11-19T09:00:00Z"), "UTC", DAY)).toBe(false);
    expect(traceOk(`plan:${DAY}:prep`, row("2026-11-19T20:00:00Z", "2026-11-20T07:00:00Z", { createdAt: "2026-11-19T20:00:00Z", prepConfirmedAt: "2026-11-20T07:00:00Z" }), "UTC", DAY)).toBe(true);
    expect(traceOk(`plan:${DAY}:prep`, row("2026-11-19T20:00:00Z", "2026-11-20T07:00:00Z", { createdAt: "2026-11-20T06:00:00Z" }), "UTC", DAY)).toBe(false);
    expect(traceOk("note:x", row(null, "2026-11-20T01:00:00Z"), "UTC", DAY)).toBe(false);
  });
});

describe("Q4.5-2 mission verify — only a fresh session, and the award only through the session-checked function", () => {
  it("a stale session: 401 session_stale; neither the day nor the Journal is read, nothing is paid", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const r = await verify(deps({ payouts: true, calls, session: { fresh: false, state: "cloud_active", reason: "session_revoked" } }));
    expect(r).toMatchObject({ status: 401, body: { error: "session_stale", state: "cloud_active", reason: "session_revoked" } });
    expect(calls.map(([fn]) => fn)).toEqual(["game_session_check"]);
  });

  it("the award gets the verified token's session, issue time and mark (the database re-checks them with the account row held)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    await verify(deps({ payouts: true, calls, apply: () => ({ data: { xp: 40, coins: 10 }, error: null }) }));
    const [, args] = calls.find(([fn]) => fn === "game_apply_reward_for_session")!;
    expect(args).toMatchObject({ p_user: A, p_session: TOKEN_A.sessionId, p_iat: TOKEN_A.iat, p_claim: "cloud_active", p_kind: "mission", p_item: "m_lesson" });
    expect(calls.some(([fn]) => fn === "game_apply_reward")).toBe(false);
  });

  it("the state changed between the check and the award: the award's own check refuses — 401 session_stale, nothing paid", async () => {
    const r = await verify(deps({ payouts: true, apply: () => ({ data: null, error: { message: "game_session_stale" } }) }));
    expect(r).toMatchObject({ status: 401, body: { error: "session_stale" } });
  });
});

describe("Q4.5-2 the mission check names the verified user", () => {
  it("every answer carries account = the session's user (checked, refused, stale)", async () => {
    expect((await verify(deps())).body.account).toBe(A);
    expect((await verify(deps({ st: status({ state: "local", day: null }) }))).body.account).toBe(A);
    expect((await verify(deps({ session: { fresh: false, state: "cloud_active" } }))).body).toMatchObject({ error: "session_stale", account: A });
  });
});

