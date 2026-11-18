import { describe, expect, it } from "vitest";
import { UNVERIFIED_WITHOUT_DAY_STATE, parseShadowRequest, shadowValidate, type CloudJournal, type CloudRow, type ShadowRequest } from "./missions-shadow";
import { SHADOW_FP_ALGO, recordFingerprint } from "./game-server/fingerprint";

// 2026-11-18 10:00 UTC = 14:00 in Tbilisi (UTC+4)
const NOW = new Date("2026-11-18T10:00:00Z");
const DAY = "2026-11-18";
const LESSON = "Урок дня: вход только после закрытия свечи над уровнем, без догоняния цены и без лишних сделок.";

function row(id: string, data: Record<string, unknown>, wroteAt = "2026-11-18T09:00:00Z"): CloudRow {
  return { id, data, updated_at: wroteAt, client_updated_at: String(data.updatedAt), deleted_at: (data.deletedAt as string) || null };
}
const note = (id: string, over: Record<string, unknown> = {}, wroteAt?: string) =>
  row(id, { id, templateKey: "lesson", body: LESSON, createdAt: "2026-11-18T08:00:00Z", updatedAt: "2026-11-18T08:00:00Z", ...over }, wroteAt);
const empty = (): CloudJournal => ({ notes: [], trades: [], plans: [] });

function run(journal: CloudJournal, request: ShadowRequest, timezone: string | null = "UTC", now = NOW) {
  return shadowValidate({ now, timezone, journal, request, fingerprint: recordFingerprint, fpAlgo: SHADOW_FP_ALGO, schemaVersion: 6, skewMs: 5 * 60 * 1000 });
}

describe("Q4.2 shadow mission check — never a payment", () => {
  it("every answer is shadow only: not authorised, the day state unverified (no server game day before Q4.3)", () => {
    const r = run({ ...empty(), notes: [note("n1")] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    expect(r.mode).toBe("shadow");
    expect(r.authorizedForPayout).toBe(false);
    expect(r.unverified).toEqual([...UNVERIFIED_WITHOUT_DAY_STATE]);
    expect(r.results[0].payout).toBe("not_authorized");
    expect(r.results[0].unverified).toEqual(["daySet", "accepted", "dayClaims", "paidToday", "dayStarted"]);
  });
});

describe("Q4.2 shadow mission check — what the server confirms", () => {
  it("a suitable record: both agree, the evidence names the version and the content fingerprint", () => {
    const n = note("n1");
    const r = run({ ...empty(), notes: [n] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    const m = r.results[0];
    expect(m.comparison).toBe("agree_done");
    expect(m.server.confirmed).toBe(true);
    expect(m.server.sources).toEqual(["note:n1"]);
    expect(m.server.flags).toEqual([]);
    expect(m.server.evidence).toEqual({ table: "journal_notes", id: "n1", version: "2026-11-18T08:00:00Z", fp: recordFingerprint(n.data) });
    // the fingerprint changes with the content, not with key order
    expect(recordFingerprint({ b: 1, a: [1, { y: 2, x: 1 }] })).toBe(recordFingerprint({ a: [1, { x: 1, y: 2 }], b: 1 }));
    expect(recordFingerprint({ ...n.data, body: LESSON + "!" })).not.toBe(m.server.evidence!.fp);
  });

  it("a record of the wrong type: a lesson does not confirm an observation; a trade source cannot be a lesson", () => {
    const r = run({ ...empty(), notes: [note("n1")] }, {
      missions: [
        { id: "m_observation", day: DAY, done: true, source: "note:n1" },
        { id: "m_lesson", day: DAY, done: true, source: "trade:t1:review" },
      ],
    });
    expect(r.results[0].comparison).toBe("client_only");
    expect(r.results[0].server.flags).toContain("sourceNotConfirmed");
    expect(r.results[0].server.reason).toBe("noteMissing");
    expect(r.results[1].server.flags).toContain("sourceUnknownForm");
    expect(r.results[1].comparison).toBe("source_differs"); // the server confirms the lesson, with the note, not the trade
  });

  it("content: a short note, a copy of an earlier note, an untouched template do not count", () => {
    const short = note("n1", { body: "Коротко." });
    const first = note("n0", { createdAt: "2026-11-10T08:00:00Z", updatedAt: "2026-11-10T08:00:00Z" }, "2026-11-10T08:00:00Z");
    const copy = note("n2");
    const r1 = run({ ...empty(), notes: [short] }, { missions: [{ id: "m_lesson", day: DAY, done: false, reason: "noteShort" }] });
    expect(r1.results[0].comparison).toBe("agree_not_done");
    expect(r1.results[0].server.reason).toBe("noteShort");
    const r2 = run({ ...empty(), notes: [first, copy] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n2" }] });
    expect(r2.results[0].comparison).toBe("client_only");
    expect(r2.results[0].server.reason).toBe("noteCopy");
  });

  it("an imported note never counts", () => {
    const r = run({ ...empty(), notes: [note("n1", { importBatchId: "imp_1" })] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    expect(r.results[0].server.confirmed).toBe(false);
    expect(r.results[0].server.reason).toBe("noteImported");
    expect(r.results[0].comparison).toBe("client_only");
  });

  it("a record deleted on the server (tombstone) does not count, even if its data claims to be live", () => {
    const n = note("n1");
    const r = run({ ...empty(), notes: [{ ...n, deleted_at: "2026-11-18T09:30:00Z" }] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    expect(r.results[0].server.confirmed).toBe(false);
    expect(r.results[0].comparison).toBe("client_only");
  });

  it("another user's record is not in the user's journal: the app's claim is not confirmed", () => {
    // the reader returns only the user's own rows (RLS + user_id filter); a foreign id is simply not there
    const r = run({ ...empty(), notes: [note("n_mine", { body: "Другой урок о том, что стоп ставится до входа и не двигается в минус." })] }, {
      missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n_other_user" }],
    });
    expect(r.results[0].server.flags).toContain("sourceNotConfirmed");
    expect(r.results[0].comparison).toBe("source_differs");
    expect(r.results[0].server.evidence?.id).toBe("n_mine");
  });

  it("server time and zone: the server's game day is used, not the app's (Tbilisi is already on the next day)", () => {
    const late = new Date("2026-11-18T21:30:00Z"); // 01:30 on the 19th in Tbilisi
    const n = note("n1", { createdAt: "2026-11-18T21:00:00Z", updatedAt: "2026-11-18T21:00:00Z" }, "2026-11-18T21:00:00Z");
    const r = run({ ...empty(), notes: [n] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] }, "Asia/Tbilisi", late);
    expect(r.serverDay).toBe("2026-11-19");
    expect(r.timezone).toBe("Asia/Tbilisi");
    expect(r.results[0].server.flags).toContain("dayDiffers");
    expect(r.results[0].server.confirmed).toBe(true); // 01:00 Tbilisi on the 19th: made on the server's day
  });

  it("an unknown zone: the day is counted in UTC and the answer says so", () => {
    const r = run({ ...empty(), notes: [note("n1")] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] }, "Mars/Olympus");
    expect(r.timezone).toBe("UTC");
    expect(r.timezoneFallback).toBe(true);
  });

  it("a record stamped later than the server received it is refused (made «in advance» with a future time)", () => {
    // written to the server yesterday, but claims to be created today
    const n = note("n1", { updatedAt: "2026-11-17T20:00:00Z" }, "2026-11-17T20:00:00Z");
    const r = run({ ...empty(), notes: [n] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    expect(r.results[0].server.confirmed).toBe(false);
    expect(r.results[0].server.flags).toContain("stampAfterServerWrite");
    expect(r.results[0].comparison).toBe("client_only");
  });

  it("one record for two missions in one request is flagged", () => {
    const n = row("n1", { id: "n1", templateKey: "session_review", body: LESSON + " Итоги сессии: план выполнен.", createdAt: "2026-11-18T08:00:00Z", updatedAt: "2026-11-18T08:00:00Z" });
    const r = run({ ...empty(), notes: [n] }, {
      missions: [
        { id: "q_reflect", day: DAY, done: true, source: "note:n1" },
        { id: "m_lesson", day: DAY, done: true, source: "note:n1" },
      ],
    });
    expect(r.results[0].server.flags).toContain("duplicateSource");
    expect(r.results[1].server.flags).toContain("duplicateSource");
  });

  it("the app did not count it, the server would: server_only (reported, nothing paid)", () => {
    const r = run({ ...empty(), notes: [note("n1")] }, { missions: [{ id: "m_lesson", day: DAY, done: false, reason: "notAccepted" }] });
    expect(r.results[0].comparison).toBe("server_only");
    expect(r.results[0].payout).toBe("not_authorized");
  });

  it("a plan: preparation from today's plan, the risk check and tomorrow's plan from the cloud rows", () => {
    const plan = row(DAY, {
      date: DAY,
      bias: [{ instrument: "EURUSD", direction: "bullish" }],
      levels: [{ price: 1.08 }],
      limits: { maxRiskPerTrade: { type: "r", value: 1 } },
      checklist: [{ key: "risk_limits_checked", done: true }],
      createdAt: "2026-11-18T07:00:00Z",
      firstSavedAt: "2026-11-18T07:00:00Z",
      updatedAt: "2026-11-18T07:00:00Z",
    });
    const r = run({ ...empty(), plans: [plan] }, {
      missions: [
        { id: "q_bias", day: DAY, done: true, source: `plan:${DAY}:prep` },
        { id: "q_riskcheck", day: DAY, done: true, source: `plan:${DAY}:risk` },
        { id: "m_plan_tomorrow", day: DAY, done: false },
      ],
    });
    expect(r.results.map((x) => x.comparison)).toEqual(["agree_done", "agree_done", "agree_not_done"]);
    expect(r.results[2].server.reason).toBe("tomorrowPlanMissing");
  });

  it("rows of a newer app version are left out and counted; unreadable rows too", () => {
    const r = run({ ...empty(), notes: [note("n1", { schemaVersion: 99 }), { id: "x" } as unknown as CloudRow] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    expect(r.skipped).toEqual({ newerSchema: 1, badRecord: 1 });
    expect(r.results[0].server.flags).toEqual(expect.arrayContaining(["newerSchema", "badRecord", "sourceNotConfirmed"]));
  });

  it("the same input twice (two tabs, a repeat) gives the same answer", () => {
    const j = { ...empty(), notes: [note("n1")] };
    const req: ShadowRequest = { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] };
    expect(run(j, req)).toEqual(run(j, req));
  });

  it("the answer carries record ids and codes only — never the record text", () => {
    const r = run({ ...empty(), notes: [note("n1")] }, { missions: [{ id: "m_lesson", day: DAY, done: true, source: "note:n1" }] });
    expect(JSON.stringify(r)).not.toContain("свечи");
  });
});

describe("Q4.2 shadow request — strict reading", () => {
  const ok = { id: "m_lesson", day: DAY, done: true, source: "note:n1" };
  it.each([
    ["not an object", "x"],
    ["no missions", {}],
    ["empty list", { missions: [] }],
    ["an extra field (an amount)", { missions: [ok], xp: 40 }],
    ["an extra mission field", { missions: [{ ...ok, coins: 10 }] }],
    ["an unknown mission", { missions: [{ ...ok, id: "m_free_xp" }] }],
    ["a repeated mission", { missions: [ok, ok] }],
    ["a bad day", { missions: [{ ...ok, day: "18.11.2026" }] }],
    ["done not boolean", { missions: [{ ...ok, done: "yes" }] }],
    ["a source of another form", { missions: [{ ...ok, source: "ledger:1" }] }],
    ["too many missions", { missions: Array.from({ length: 11 }, () => ok) }],
  ])("refuses %s", (_name, body) => {
    expect(parseShadowRequest(body)).toEqual({ ok: false, error: "bad_request" });
  });
  it("accepts a well-formed request", () => {
    expect(parseShadowRequest({ missions: [ok, { id: "q_bias", day: DAY, done: false, reason: "planMissing" }] }).ok).toBe(true);
  });
});
