import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimKeyOf, shadowValidate, type CloudJournal, type CloudRow, type ServerDayView, type ShadowRequest } from "./missions-shadow";
import { SHADOW_FP_ALGO, recordFingerprint } from "./game-server/fingerprint";
import { SHADOW_DIAGNOSTIC_CATEGORIES, shadowDiagnosticRows } from "./shadow-diagnostics";

// Q4.3: the shadow check reads the server game day (0015 game_my_day) when the account has one, and can then say
// whether the mission was assigned, accepted, paid, whether the day is full and whether the record is taken.

const NOW = new Date("2026-11-20T10:00:00Z");
const DAY = "2026-11-20";
const LESSON = "Урок дня: вход только после закрытия свечи над уровнем, без догоняния цены и без лишних сделок.";
const note = (id: string, at = "2026-11-20T08:00:00Z"): CloudRow => ({
  id,
  data: { id, templateKey: "lesson", body: LESSON + " " + id, createdAt: at, updatedAt: at },
  updated_at: "2026-11-20T09:00:00Z",
  client_updated_at: at,
  deleted_at: null,
});
const journal = (): CloudJournal => ({ notes: [note("n1"), note("n2")], trades: [], plans: [] });
const view = (over: Partial<NonNullable<ServerDayView["day"]>> = {}, extra: Partial<ServerDayView> = {}): ServerDayView => ({
  current_day: DAY,
  day: { game_day: DAY, status: "open", mode: "study", core: ["m_observation", "m_backtest", "m_lesson"], accepted: { m_lesson: "2026-11-20T09:30:00Z" }, ...over },
  paid: [],
  claims: [],
  ...extra,
});
const run = (serverDay: ServerDayView | null, request: ShadowRequest, now = NOW, timezone = "UTC") =>
  shadowValidate({ now, timezone, journal: journal(), request, fingerprint: recordFingerprint, fpAlgo: SHADOW_FP_ALGO, schemaVersion: 6, skewMs: 300_000, serverDay });
const lesson: ShadowRequest = { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] };

describe("Q4.3 shadow check with the server day", () => {
  it("no server day (local account, 0015 not applied): everything about the day stays unconfirmed", () => {
    const r = run(null, lesson);
    expect(r.unverified).toEqual(["daySet", "accepted", "dayClaims", "paidToday", "dayStarted"]);
    expect(r.results[0].server.day).toBeUndefined();
    expect(r.authorizedForPayout).toBe(false);
  });

  it("an open server day: assigned and accepted — nothing left unconfirmed, still no payment authorised", () => {
    const r = run(view(), lesson);
    expect(r.unverified).toEqual([]);
    expect(r.results[0].server.day).toEqual({ assigned: true, accepted: true, paid: false, dayFull: false, sourceUsed: false });
    expect(r.results[0].server.flags).toEqual([]);
    expect(r.results[0].payout).toBe("not_authorized");
    expect(r.authorizedForPayout).toBe(false);
  });

  it("not accepted on the server; another mode's mission; rest", () => {
    const notAccepted = run(view({ accepted: {} }), lesson);
    expect(notAccepted.results[0].server.flags).toContain("notAccepted");
    const otherMode = run(view({ mode: "trading", core: ["q_bias", "q_riskcheck", "q_reflect"] }), lesson);
    expect(otherMode.results[0].server.flags).toContain("notAssigned");
    const rest = run(view({ mode: "rest" }), lesson);
    expect(rest.results[0].server.day!.assigned).toBe(false);
  });

  it("already paid on the server; a full day; the record taken by another mission", () => {
    const paid = run(view({}, { paid: ["m_lesson"], claims: ["journal_notes:n1:"] }), lesson);
    expect(paid.results[0].server.day).toMatchObject({ paid: true, sourceUsed: false });
    expect(paid.results[0].server.flags).toContain("alreadyPaid");
    const full = run(view({ accepted: { m_backtest: "x" } }, { paid: ["q_bias", "m_observation", "m_lesson"] }), { missions: [{ id: "m_backtest", day: DAY, done: false }] });
    expect(full.results[0].server.flags).toContain("dayFull");
    const taken = run(view({}, { paid: ["m_observation"], claims: ["journal_notes:n1:"] }), lesson);
    expect(taken.results[0].server.day!.sourceUsed).toBe(true);
    expect(taken.results[0].server.flags).toContain("sourceUsed");
  });

  it("the server day's cursor wins: after a zone change «behind», the server keeps the later day", () => {
    // in Los Angeles it is still the 19th, but the account's day already moved to the 20th
    const r = run(view(), { missions: [{ id: "m_lesson", day: "2026-11-19", done: true, source: "note:n1" }] }, new Date("2026-11-20T06:00:00Z"), "America/Los_Angeles");
    expect(r.serverDay).toBe(DAY);
    expect(r.results[0].server.flags).toContain("dayDiffers");
    expect(r.results[0].server.day!.accepted).toBe(true);
  });

  it("the server day is yesterday's (not opened yet today): dayNotOpen, the day unconfirmed", () => {
    const r = run(view({ game_day: "2026-11-19" }, { current_day: "2026-11-19" }), lesson);
    expect(r.serverDay).toBe(DAY);
    expect(r.results[0].server.flags).toContain("dayNotOpen");
    expect(r.unverified).toHaveLength(5);
  });

  it("claim keys match the ones the 0014 award writes", () => {
    expect(claimKeyOf("note:n1")).toBe("journal_notes:n1:");
    expect(claimKeyOf("trade:t1:review")).toBe("journal_trades:t1:review");
    expect(claimKeyOf(`plan:${DAY}:prep`)).toBe(`journal_day_plans:${DAY}:prep`);
    expect(claimKeyOf("ledger:1")).toBeNull();
  });
});

describe("Q4.3 shadow diagnostics model", () => {
  it("rows carry only category, mission, day, rules version and time — nothing of the person or the record", () => {
    const r = run(view({ accepted: {} }), { missions: [{ id: "m_lesson", day: "2026-11-19", done: true, source: "note:zz" }] });
    const rows = shadowDiagnosticRows(r, NOW);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["category", "checked_at", "game_day", "mission_id", "rules_version"]);
    expect(rows.map((x) => x.category)).toEqual(expect.arrayContaining(["source_differs", "dayDiffers", "sourceNotConfirmed", "notAccepted"]));
    const text = JSON.stringify(rows);
    for (const leak of ["n1", "zz", "свечи", "note:"]) expect(text).not.toContain(leak);
  });

  it("agreement gives no row; at most ten rows", () => {
    expect(shadowDiagnosticRows(run(view(), lesson), NOW)).toEqual([]);
  });

  it("the categories are exactly the ones the 0015 table accepts", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase/migrations/0015_game_days.sql"), "utf8");
    const check = /category TEXT NOT NULL CHECK \(category IN \(([\s\S]*?)\)\)/.exec(sql)![1];
    const inSql = [...check.matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...SHADOW_DIAGNOSTIC_CATEGORIES].sort());
  });
});
