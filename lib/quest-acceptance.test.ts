import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  acceptMission,
  acceptedMissions,
  checkAndApplyDateResets,
  claimMissions,
  completeQuest,
  evaluatePlanQuestClosure,
  questStates,
  recordNoteSaved,
  setDayMode,
  verifyMission,
  xpForNextLevel,
  type GameState,
} from "./game";
import { GameStore } from "./game-store";
import { GAME_CONFIG } from "./game-config";
import type { Note, TradingPlan } from "./journal/types";
import { explainMission, type MissionData } from "./missions";

// QH-6.6: «Accept → Go to the Journal → Verify → Completed». Accepting gives nothing; only «Verify» of an accepted mission
// pays, through the one claim of QH-6.4 (its ledger, three a day, the QH-6.2 checks); a journal save pays nothing by itself.

const DAY = "2026-11-16";
const at = (iso: string) => new Date(iso);
const t = (hhmm: string, day = DAY) => at(`${day}T${hhmm}:00Z`);
const iso = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;

function started(extra: Partial<GameState> = {}): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", lastQuestDate: "2026-11-15", journalFirstTradeDay: null, profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" }, ...extra } as GameState;
  return checkAndApplyDateResets(base, t("06:00"));
}
const total = (s: GameState) => {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += xpForNextLevel(lv);
  return sum;
};
const wealth = (s: GameState) => JSON.stringify([total(s), s.coins, s.history.length, s.achievements, s.completedQuestsToday, s.questDays]);
const plan = (over: Partial<TradingPlan> = {}): TradingPlan => ({
  date: DAY,
  bias: [{ instrument: "EURUSD", direction: "bullish" }],
  levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }],
  events: [],
  limits: { maxTrades: 3 },
  checklist: [{ key: "risk_limits_checked", done: true }],
  createdAt: iso("07:00"),
  firstSavedAt: iso("07:00"),
  updatedAt: iso("07:00"),
  ...over,
});
const note = (id: string, templateKey: Note["templateKey"], body: string, over: Partial<Note> = {}): Note => ({
  id, templateKey, body, tags: [], pinned: false, createdAt: iso("12:00"), updatedAt: iso("12:00"), archivedAt: null, ...over,
});
const LESSON = "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.";
const IDEA = "Наблюдение: EURUSD снял азиатский максимум и вернулся в диапазон — ложный пробой.";
const data = (over: Partial<MissionData> = {}): MissionData => ({ plans: [], notes: [], trades: [], timezone: "UTC", ...over });
const acceptAll = (s: GameState, when: Date) => {
  let n = checkAndApplyDateResets(s, when);
  for (const id of n.questDay?.core || []) n = acceptMission(n, id, when).state;
  return n;
};

describe("QH-6.6 accepting a quest", () => {
  it("accepting gives nothing and keeps the first time; it survives a reload (saved in the game)", () => {
    const s = started();
    const a = acceptMission(s, "q_bias", t("07:10"));
    expect(a.ok).toBe(true);
    expect(wealth(a.state)).toBe(wealth(s));
    expect(a.state.questAccepted).toEqual({ day: DAY, at: { q_bias: "2026-11-16T07:10:00.000Z" } });
    const again = acceptMission(JSON.parse(JSON.stringify(a.state)), "q_bias", t("09:00"));
    expect(again.state.questAccepted!.at.q_bias).toBe("2026-11-16T07:10:00.000Z");
    expect([...acceptedMissions(again.state, DAY)]).toEqual(["q_bias"]);
  });

  it("only a mission of today's active set; never on a rest day; a paid mission is already done", () => {
    const s = started();
    expect(acceptMission(s, "m_lesson", t("07:00"))).toMatchObject({ ok: false, reason: "notInSet" });
    expect(acceptMission(s, "q_walk", t("07:00"))).toMatchObject({ ok: false, reason: "notMission" });
    const rest = setDayMode(s, "rest", t("07:00")).state;
    expect(acceptMission(rest, "q_bias", t("07:01"))).toMatchObject({ ok: false, reason: "rest" });
    const paid = completeQuest(s, "q_bias", "Bias", "trading", 40, 10, t("07:00")).state;
    expect(acceptMission(paid, "q_bias", t("07:01"))).toMatchObject({ ok: false, reason: "done" });
  });

  it("a new game day starts with nothing accepted", () => {
    const a = acceptMission(started(), "q_bias", t("07:10")).state;
    const next = checkAndApplyDateResets(a, t("06:00", "2026-11-17"));
    expect(acceptedMissions(next, "2026-11-17").size).toBe(0);
    expect(questStates(next, data(), t("06:01", "2026-11-17")).q_bias).toBe("available");
  });
});

describe("QH-6.6 the four states and «Verify»", () => {
  it("accept → go → save → verify: available → accepted → ready → completed; 40 XP + 10 Coins once", () => {
    let s = started();
    expect(questStates(s, data(), t("07:00")).q_bias).toBe("available");
    s = acceptMission(s, "q_bias", t("07:05")).state;
    expect(questStates(s, data(), t("07:06")).q_bias).toBe("accepted");
    // the save itself pays nothing
    const saved = evaluatePlanQuestClosure(s, plan(), [], [plan()], [], t("07:30"));
    expect(saved.state.completedQuestsToday.q_bias).toBeUndefined();
    s = saved.state;
    expect(questStates(s, data({ plans: [plan()] }), t("07:31")).q_bias).toBe("ready");
    const coins = s.coins;
    const v = verifyMission(s, "q_bias", data({ plans: [plan()] }), t("07:40"));
    expect(v.paid).toBe(true);
    expect(v.state.coins - coins).toBe(GAME_CONFIG.QUEST_COINS);
    expect(v.state.history.find((h) => h.questId === "q_bias")).toMatchObject({ xp: 40, coins: 10, at: "2026-11-16T07:40:00.000Z" });
    expect(v.state.missionLedger!.claims.q_bias).toBe(`plan:${DAY}:prep`);
    expect(questStates(v.state, data({ plans: [plan()] }), t("07:41")).q_bias).toBe("completed");
    // a second «Verify», a reload, a later verify: nothing more
    const again = verifyMission(JSON.parse(JSON.stringify(v.state)), "q_bias", data({ plans: [plan()] }), t("12:00"));
    expect(again.paid).toBe(false);
    expect(wealth(again.state)).toBe(wealth(v.state));
  });

  it("save → accept → verify: a record made earlier the same day counts; yesterday's record does not", () => {
    let s = setDayMode(started(), "study", t("07:00")).state;
    const today = note("l1", "lesson", LESSON, { createdAt: iso("08:00") });
    s = recordNoteSaved(s, today, [today], t("08:00")).state; // saved before the quest was accepted
    expect(questStates(s, data({ notes: [today] }), t("09:00")).m_lesson).toBe("available");
    s = acceptMission(s, "m_lesson", t("09:00")).state;
    expect(questStates(s, data({ notes: [today] }), t("09:01")).m_lesson).toBe("ready");
    expect(verifyMission(s, "m_lesson", data({ notes: [today] }), t("09:02")).paid).toBe(true);

    const old = note("l0", "lesson", LESSON, { createdAt: iso("20:00", "2026-11-15") });
    const s2 = acceptMission(setDayMode(started(), "study", t("07:00")).state, "m_lesson", t("09:00")).state;
    const r = verifyMission(s2, "m_lesson", data({ notes: [old] }), t("09:01"));
    expect(r.paid).toBe(false);
    expect(r.failure).toMatchObject({ reason: "noteMissing", min: 60 });
  });

  it("verify without data: nothing paid, the exact thing to add is named", () => {
    const s = acceptAll(started(), t("07:00"));
    const before = wealth(s);
    expect(verifyMission(s, "q_bias", data(), t("08:00")).failure).toEqual({ reason: "planMissing" });
    expect(verifyMission(s, "q_bias", data({ plans: [plan({ bias: [{ instrument: "EURUSD" }] })] }), t("08:00")).failure).toEqual({ reason: "directionMissing" });
    expect(verifyMission(s, "q_bias", data({ plans: [plan({ levels: [] })] }), t("08:00")).failure).toEqual({ reason: "levelMissing" });
    expect(verifyMission(s, "q_bias", data({ plans: [plan({ createdAt: iso("20:00", "2026-11-15"), firstSavedAt: iso("20:00", "2026-11-15") })] }), t("08:00")).failure).toEqual({ reason: "planNotToday" });
    expect(verifyMission(s, "q_riskcheck", data({ plans: [plan({ limits: {} })] }), t("08:00")).failure).toEqual({ reason: "limitsMissing" });
    expect(verifyMission(s, "q_riskcheck", data({ plans: [plan({ limits: { maxTrades: 0 } })] }), t("08:00")).failure).toEqual({ reason: "limitsInvalid" });
    expect(verifyMission(s, "q_riskcheck", data({ plans: [plan({ checklist: [] })] }), t("08:00")).failure).toEqual({ reason: "riskItemUnchecked" });
    expect(verifyMission(s, "q_reflect", data({ plans: [plan()] }), t("08:00")).failure).toEqual({ reason: "reviewMissing", min: 40 });
    expect(wealth(s)).toBe(before);
    // the explanation is only words: it confirms nothing
    expect(explainMission("q_bias", data({ plans: [plan()] }), DAY)).toBeNull();
  });

  it("a mission not accepted is never paid — by «Verify» or by any save", () => {
    const s = started();
    expect(verifyMission(s, "q_bias", data({ plans: [plan()] }), t("08:00")).failure).toEqual({ reason: "notAccepted" });
    expect(claimMissions(s, data({ plans: [plan()] }), t("08:00")).claimed).toEqual([]);
    expect(evaluatePlanQuestClosure(s, plan(), [], [plan()], [], t("08:00")).state.completedQuestsToday.q_bias).toBeUndefined();
  });

  it("imported notes never pay, even accepted and verified", () => {
    const s = acceptAll(setDayMode(started(), "study", t("07:00")).state, t("07:01"));
    const imported = note("imp", "lesson", LESSON, { importBatchId: "b1", importedAt: iso("10:00") });
    const r = verifyMission(s, "m_lesson", data({ notes: [imported] }), t("12:00"));
    expect(r.paid).toBe(false);
    expect(r.failure).toMatchObject({ reason: "noteImported" });
  });
});

describe("QH-6.6 limits, modes, tabs, old saves", () => {
  it("three paid a day: accepting and verifying in other modes after three pays nothing (dayFull)", () => {
    const d = data({ plans: [plan({ review: { rating: 4, followedPlan: "yes", emotions: ["calm"], whatWorked: "Waited for the retest and kept the risk small today.", completedAt: iso("19:00") } })], notes: [note("l1", "lesson", LESSON), note("i1", "idea", IDEA)] });
    let s = acceptAll(started(), t("07:00"));
    for (const id of ["q_bias", "q_riskcheck", "q_reflect"]) s = verifyMission(s, id, d, t("19:05")).state;
    const three = wealth(s);
    for (const m of ["study", "recovery", "trading", "study"] as const) {
      s = acceptAll(setDayMode(s, m, t("20:00")).state, t("20:01"));
      for (const id of s.questDay!.core) {
        const r = verifyMission(s, id, d, t("20:02"));
        s = r.state;
        if (!s.completedQuestsToday[id]) expect(r.failure?.reason).toBe("dayFull");
      }
    }
    expect(wealth(s)).toBe(three);
  });

  it("one record pays one mission: the review used by «Day state» does not pay «Day review» (sourceUsed)", () => {
    const review = { rating: 4, followedPlan: "yes" as const, emotions: ["calm"], whatWorked: "Waited for the retest and kept the risk small today.", completedAt: iso("19:00") };
    const d = data({ plans: [plan({ bias: [], levels: [], limits: {}, review })] });
    let s = acceptAll(setDayMode(started(), "recovery", t("07:00")).state, t("07:01"));
    s = verifyMission(s, "m_day_state", d, t("19:05")).state;
    expect(s.completedQuestsToday.m_day_state).toBe(true);
    s = acceptAll(setDayMode(s, "trading", t("19:10")).state, t("19:11"));
    expect(verifyMission(s, "q_reflect", d, t("19:12")).failure).toEqual({ reason: "sourceUsed" });
  });

  it("an accepted mission of another mode cannot be paid after a mode change; its slot is gone", () => {
    let s = acceptAll(started(), t("07:00")); // trading accepted
    s = setDayMode(s, "study", t("08:00")).state; // nothing done yet: the study missions take the slots
    const r = claimMissions(s, data({ plans: [plan()] }), t("08:10"));
    expect(r.claimed).toEqual([]);
    expect(questStates(s, data({ plans: [plan()] }), t("08:11")).q_bias).toBeUndefined();
  });

  it("two tabs verify the same quest on one saved state under the shared lock — paid once", async () => {
    const s0 = acceptAll(started(), t("07:00"));
    const saved = { raw: JSON.stringify(s0) };
    const now = t("08:00");
    const tab = () => {
      const store = new GameStore<GameState>({ read: () => saved.raw, write: (raw) => ((saved.raw = raw), true), parse: (raw) => checkAndApplyDateResets(JSON.parse(raw), now) });
      store.noteLoaded(saved.raw);
      return store;
    };
    const d = data({ plans: [plan()] });
    const [a, b] = [tab(), tab()];
    const ra = await a.applyLocked(() => s0, (fresh) => { const r = verifyMission(fresh, "q_bias", d, now); return { state: r.state, result: r.paid }; });
    const rb = await b.applyLocked(() => s0, (fresh) => { const r = verifyMission(fresh, "q_bias", d, now); return { state: r.state, result: r.paid }; });
    expect([ra.saved && ra.result, rb.saved && rb.result]).toEqual([true, false]);
    expect((JSON.parse(saved.raw) as GameState).coins - s0.coins).toBe(GAME_CONFIG.QUEST_COINS);
  });

  it("an old save: missions paid before QH-6.6 stay completed without acceptance; nothing changes in it", () => {
    let s = started();
    s = completeQuest(s, "q_bias", "Bias", "trading", 40, 10, t("07:30")).state; // paid by the QH-6.4 path, no acceptance
    delete (s as Partial<GameState>).questAccepted;
    const before = wealth(s);
    const st = questStates(s, data({ plans: [plan()] }), t("08:00"));
    expect(st).toMatchObject({ q_bias: "completed", q_riskcheck: "available", q_reflect: "available" });
    expect(wealth(s)).toBe(before);
  });

  it("a day set from before catalog 3 has no quest states; its old closing keeps working", () => {
    let s = started();
    s = { ...s, questDay: { day: DAY, mode: "trading", catalogVersion: 2, core: ["q_walk", "q_meditate", "q_nosocial"], bonus: [] } };
    expect(questStates(s, data({ plans: [plan()] }), t("08:00"))).toEqual({});
    expect(evaluatePlanQuestClosure(s, plan(), [], [plan()], [], t("08:00")).closedQuests).toEqual(expect.arrayContaining(["q_bias", "q_riskcheck"]));
  });

  it("the day snapshot keeps the verified mission with its time, reward and record; acceptance changes no snapshot", () => {
    let s = acceptMission(started(), "q_bias", t("07:00")).state;
    s = verifyMission(s, "q_bias", data({ plans: [plan()] }), t("07:45")).state;
    s = checkAndApplyDateResets(s, t("06:00", "2026-11-17"));
    expect(s.questDays![0].done.q_bias).toMatchObject({ at: "2026-11-16T07:45:00.000Z", xp: 40, coins: 10, missionSource: `plan:${DAY}:prep` });
    const snapBefore = JSON.stringify(s.questDays);
    const acceptedNextDay = acceptMission(s, "q_bias", t("07:00", "2026-11-17")).state;
    expect(JSON.stringify(acceptedNextDay.questDays)).toBe(snapBefore);
  });
});
