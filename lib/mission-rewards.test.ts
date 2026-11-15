import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  claimMissions,
  completeSelfReportQuest,
  evaluatePlanQuestClosure,
  pendingMissionClaims,
  recordNoteSaved,
  selfReportXpOn,
  setDayMode,
  xpForNextLevel,
  type GameState,
} from "./game";
import { GameStore } from "./game-store";
import { GAME_CONFIG } from "./game-config";
import { LocalStorageJournalRepository } from "./journal/repository";
import type { BacktestResult, Note, Trade, TradingPlan } from "./journal/types";
import type { MissionData } from "./missions";

// QH-6.4 (docs/quest-hub-qh6-spec.md, 6, 8): the verifiable missions are paid from the saved journal — 40 XP + 10 Coins,
// once per mission and day, one record per mission, three a day at most, never for old, imported or other days' records.

const DAY = "2026-11-16"; // Monday
const at = (iso: string) => new Date(iso);
const t = (hhmm: string, day = DAY) => at(`${day}T${hhmm}:00Z`);
const iso = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;

function started(extra: Partial<GameState> = {}, zone = "UTC"): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", lastQuestDate: "2026-11-15", journalFirstTradeDay: null, profile: { ...INITIAL_GAME_STATE.profile, timezone: zone }, ...extra } as GameState;
  return checkAndApplyDateResets(base, t("06:00"));
}
const totalXp = (s: GameState) => {
  let sum = s.xp;
  for (let lv = 1; lv < s.level; lv++) sum += xpForNextLevel(lv);
  return sum;
};
const paid = (s: GameState) => ({ xp: totalXp(s), coins: s.coins, history: s.history.length });

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
const review = (day = DAY) => ({ rating: 4, followedPlan: "yes" as const, emotions: ["calm"], whatWorked: "Waited for the retest and kept the risk small today.", completedAt: iso("19:00", day) });
const note = (id: string, templateKey: Note["templateKey"], body: string, over: Partial<Note> = {}): Note => ({
  id, templateKey, body, tags: [], pinned: false, createdAt: iso("12:00"), updatedAt: iso("12:00"), archivedAt: null, ...over,
});
const LESSON = "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.";
const IDEA = "Наблюдение: EURUSD снял азиатский максимум и вернулся в диапазон — ложный пробой.";
const MISTAKE = "Ошибка: в пятницу я дважды передвинул стоп. Дальше стоп стоит там, где его поставил план дня.";
const result = (over: Partial<BacktestResult> = {}): BacktestResult => ({
  instrument: "EURUSD", timeframe: "H1", periodFrom: "2026-01-01", periodTo: "2026-06-30", setup: "Retest", strategyId: null,
  setups: 20, wins: 11, losses: 7, breakeven: 2, avgWinR: null, avgLossR: null, ...over,
});
const backtest = (id: string, r = result()) => note(id, "backtest", "Вывод: ретест работает в Лондоне, в Азии — нет; беру только лондонские входы.", { backtest: r });
const data = (over: Partial<MissionData> = {}): MissionData => ({ plans: [], notes: [], trades: [], timezone: "UTC", ...over });

describe("QH-6.4 a confirmed mission is paid once, from the saved journal", () => {
  it("40 XP + 10 Coins; the time and the reward go to the history; the record goes to the ledger", () => {
    const s = started();
    const r = claimMissions(s, data({ plans: [plan()] }), t("08:00"));
    expect(r.claimed).toEqual(["q_bias", "q_riskcheck"]);
    expect(r.xp).toBe(2 * GAME_CONFIG.QUEST_XP);
    expect(r.coins).toBe(2 * GAME_CONFIG.QUEST_COINS);
    const h = r.state.history.find((x) => x.questId === "q_bias")!;
    expect(h).toMatchObject({ xp: 40, coins: 10, completedAt: DAY, at: "2026-11-16T08:00:00.000Z" });
    expect(r.state.missionLedger).toEqual({ day: DAY, claims: { q_bias: `plan:${DAY}:prep`, q_riskcheck: `plan:${DAY}:risk` } });
  });

  it("a double click, the same save again, a reload or a later check pay nothing more", () => {
    const d = data({ plans: [plan()] });
    let s = claimMissions(started(), d, t("08:00")).state;
    const once = paid(s);
    for (const when of ["08:00", "08:01", "12:00", "23:59"]) {
      s = claimMissions(s, d, t(when)).state;
      s = claimMissions(JSON.parse(JSON.stringify(s)), { ...d, plans: [{ ...plan(), updatedAt: iso(when) }] }, t(when)).state; // a copy (reload), a new save
    }
    expect(paid(s)).toEqual(once);
    expect(pendingMissionClaims(s, d, t("23:59"))!.fresh).toEqual([]);
  });

  it("two tabs: both claim on the same saved state under the shared lock — paid once", async () => {
    const saved = { raw: JSON.stringify(started()) };
    const now = t("09:00");
    const tab = () => {
      const store = new GameStore<GameState>({ read: () => saved.raw, write: (raw) => ((saved.raw = raw), true), parse: (raw) => checkAndApplyDateResets(JSON.parse(raw), now) });
      store.noteLoaded(saved.raw);
      return store;
    };
    const d = data({ plans: [plan()] });
    const stale = JSON.parse(saved.raw) as GameState;
    const [a, b] = [tab(), tab()];
    const ra = await a.applyLocked(() => stale, (fresh) => { const r = claimMissions(fresh, d, now); return { state: r.state, result: r.claimed.length }; });
    const rb = await b.applyLocked(() => stale, (fresh) => { const r = claimMissions(fresh, d, now); return { state: r.state, result: r.claimed.length }; });
    expect([ra.saved && ra.result, rb.saved && rb.result]).toEqual([2, 0]);
    const final = JSON.parse(saved.raw) as GameState;
    expect(final.coins - stale.coins).toBe(2 * GAME_CONFIG.QUEST_COINS);
  });

  it("the day plan's save pays the trading missions through the same claim (and its ledger)", () => {
    const s = started();
    const r = evaluatePlanQuestClosure(s, plan({ review: review() }), [], [plan({ review: review() })], [], t("19:05"));
    expect(r.closedQuests).toEqual(["q_bias", "q_riskcheck", "q_reflect"]);
    expect(r.state.missionLedger!.claims.q_reflect).toBe(`plan:${DAY}:review`);
    // the plan saved again later and the bridge's claim after it: nothing more
    const again = claimMissions(evaluatePlanQuestClosure(r.state, plan({ review: review() }), [], [], [], t("19:10")).state, data({ plans: [plan({ review: review() })] }), t("19:11"));
    expect(paid(again.state)).toEqual(paid(r.state));
  });
});

describe("QH-6.4 one record, one mission; three a day; only the active set", () => {
  it("the day review used by «Day state» does not also pay «Day review» after a mode change; another record does", () => {
    let s = setDayMode(started(), "recovery", t("07:00")).state;
    const d = data({ plans: [{ ...plan({ bias: [], levels: [], limits: {} }), review: review() }] });
    s = claimMissions(s, d, t("19:05")).state;
    expect(s.completedQuestsToday.m_day_state).toBe(true);
    s = setDayMode(s, "trading", t("19:10")).state;
    expect(claimMissions(s, d, t("19:11")).claimed).toEqual([]);
    const withNote = { ...d, notes: [note("s1", "session_review", "Итог сессии: два входа по плану, один пропуск без сожалений; риск держал в пределах лимита.")] };
    expect(claimMissions(s, withNote, t("19:12")).claimed).toEqual(["q_reflect"]);
  });

  it("never more than three paid missions a day, whatever the mode changes", () => {
    let s = started();
    const all = data({
      plans: [plan({ review: review() }), plan({ date: "2026-11-17", createdAt: iso("21:00"), firstSavedAt: iso("21:00") })],
      notes: [note("l1", "lesson", LESSON), note("i1", "idea", IDEA), note("w1", "weekly_mistake", MISTAKE), backtest("b1")],
    });
    s = claimMissions(s, all, t("08:00")).state; // trading: three
    expect(Object.keys(s.missionLedger!.claims)).toHaveLength(3);
    const three = paid(s);
    for (const m of ["study", "recovery", "rest", "trading", "study"] as const) {
      s = setDayMode(s, m, t("20:00")).state;
      s = claimMissions(s, all, t("20:01")).state;
    }
    expect(paid(s)).toEqual(three);
    expect(Object.keys(s.missionLedger!.claims)).toHaveLength(3);
  });

  it("a mission of another mode is not paid (only the active set); a rest day pays nothing", () => {
    const d = data({ notes: [note("l1", "lesson", LESSON)] });
    expect(claimMissions(started(), d, t("12:30")).claimed).toEqual([]); // trading day: «Lesson» is not in it
    const rest = setDayMode(started(), "rest", t("07:00")).state;
    expect(pendingMissionClaims(rest, data({ plans: [plan()] }), t("08:00"))).toBeNull();
    expect(paid(claimMissions(rest, data({ plans: [plan()] }), t("08:00")).state)).toEqual(paid(rest));
  });

  it("study without trades: «Observation», «Backtest», «Lesson» are paid; a copied backtest result is not", () => {
    let s = setDayMode(started(), "study", t("07:00")).state;
    expect(s.questDay!.core).toEqual(["m_observation", "m_backtest", "m_lesson"]);
    const earlier = backtest("b0", result());
    const d = data({ notes: [{ ...earlier, createdAt: iso("10:00", "2026-11-10") }, backtest("b1", result()), note("i1", "idea", IDEA), note("l1", "lesson", LESSON)] });
    const r = claimMissions(s, d, t("13:00"));
    expect(r.claimed).toEqual(["m_observation", "m_lesson"]); // b1 is the same result as the earlier b0
    s = claimMissions(r.state, { ...d, notes: [...d.notes, backtest("b2", result({ setups: 12, wins: 6, losses: 5, breakeven: 1 }))] }, t("14:00")).state;
    expect(s.completedQuestsToday.m_backtest).toBe(true);
  });
});

describe("QH-6.4 nothing old, imported or from another day is paid", () => {
  it("imported notes and backtests never pay, even after an edit", () => {
    localStorage.clear();
    const repo = new LocalStorageJournalRepository();
    repo.importNotes([{ ...note("imp1", "lesson", LESSON), importBatchId: "b1", importedAt: iso("10:00") }, { ...backtest("imp2"), importBatchId: "b1" }]);
    repo.saveNote(note("imp1", "lesson", `${LESSON} Дописал сегодня.`));
    const s = setDayMode(started(), "study", t("07:00")).state;
    const r = claimMissions(s, data({ notes: repo.getAllRecords().notes }), t("13:00"));
    expect(r.claimed).toEqual([]);
  });

  it("records of earlier days are never paid: not today, not the next day, not after a restored account", () => {
    const yesterday = "2026-11-15";
    const old = data({
      plans: [plan({ date: yesterday, createdAt: iso("07:00", yesterday), firstSavedAt: iso("07:00", yesterday), review: review(yesterday) })],
      notes: [note("l1", "lesson", LESSON, { createdAt: iso("12:00", yesterday) })],
      trades: [{ id: "t1", openedAt: iso("10:00", "2026-11-10"), createdAt: iso("10:00", "2026-11-10"), entryReason: "R", emotions: ["calm"], executionRating: 4, reviewedAt: iso("11:00", yesterday) } as Trade],
    });
    for (const mode of ["trading", "study", "recovery"] as const) {
      const s = setDayMode(started({ journalFirstTradeDay: "2026-11-10" }), mode, t("07:00")).state;
      expect(claimMissions(s, old, t("09:00")).claimed).toEqual([]);
    }
    // a restored account with a long history: its XP, Coins and history stay; nothing is paid for the old journal
    const restored = started({ xp: 120, level: 9, coins: 777, history: [{ questId: "q_bias", questTitle: "Bias", category: "trading", xp: 40, coins: 10, completedAt: "2026-10-01" }] });
    const r = claimMissions(restored, old, t("09:00"));
    expect(r.claimed).toEqual([]);
    expect(paid(r.state)).toEqual(paid(restored));
  });

  it("a clock moved back pays nothing", () => {
    let s = claimMissions(started(), data({ notes: [] }), t("15:00")).state;
    s = { ...s, lastSeenAt: Date.parse("2026-11-16T15:00:00.000Z") } as GameState;
    const r = claimMissions(s, data({ plans: [plan()] }), t("09:00"));
    expect(r.claimed).toEqual([]);
  });

  it("the game day is the account time zone: a note at 23:30 in Tbilisi pays that day; it does not pay the next day", () => {
    // Tbilisi = UTC+4: 19:30 UTC is 23:30 on 11-16
    let s = setDayMode(started({}, "Asia/Tbilisi"), "study", t("06:30")).state;
    const late = data({ notes: [note("l1", "lesson", LESSON, { createdAt: "2026-11-16T19:30:00.000Z" })], timezone: "Asia/Tbilisi" });
    s = claimMissions(s, late, at("2026-11-16T19:31:00Z")).state;
    expect(s.completedQuestsToday.m_lesson).toBe(true);
    const next = checkAndApplyDateResets(s, at("2026-11-16T20:30:00Z")); // 00:30 on 11-17
    const r = claimMissions(setDayMode(next, "study", at("2026-11-16T20:31:00Z")).state, late, at("2026-11-16T20:32:00Z"));
    expect(r.claimed).toEqual([]);
  });
});

describe("QH-6.4 the rest of the economy stays as it is", () => {
  it("mission XP is not self-report XP (the 90 XP cap of self-reports is untouched)", () => {
    let s = claimMissions(started(), data({ plans: [plan()] }), t("08:00")).state;
    expect(selfReportXpOn(s, DAY)).toBe(0);
    const extra = s.questDay!.bonus[0];
    s = completeSelfReportQuest(s, extra, extra, "Mental", 999, t("09:00")).state;
    expect(selfReportXpOn(s, DAY)).toBeGreaterThan(0);
    expect(selfReportXpOn(s, DAY)).toBeLessThanOrEqual(GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP);
  });

  it("the journal's own rewards (a note's XP) are given as before, apart from the mission", () => {
    let s = setDayMode(started(), "study", t("07:00")).state;
    // 80+ characters: the existing note XP rule
    const l = note("l1", "lesson", `${LESSON} Проверю это правило ещё на десяти сделках.`);
    const n = recordNoteSaved(s, l, [l], t("12:00"));
    expect(n.xpAwarded).toBeGreaterThan(0); // the existing note XP
    s = claimMissions(n.state, data({ notes: [l] }), t("12:01")).state;
    expect(s.completedQuestsToday.m_lesson).toBe(true);
  });

  it("the day snapshot keeps the time, the reward and the record of each paid mission", () => {
    let s = claimMissions(started(), data({ plans: [plan()] }), t("08:00")).state;
    s = checkAndApplyDateResets(s, t("06:00", "2026-11-17"));
    const snap = s.questDays![0];
    expect(snap.day).toBe(DAY);
    expect(snap.done.q_bias).toMatchObject({ source: "journal", at: "2026-11-16T08:00:00.000Z", xp: 40, coins: 10, missionSource: `plan:${DAY}:prep` });
    expect(snap.totals.selfXp).toBe(0);
    // the new day starts with an empty ledger
    expect(claimMissions(s, data({ plans: [plan()] }), t("08:00", "2026-11-17")).claimed).toEqual([]);
  });

  it("a day set from before catalog 3 keeps the old closing of the trading quests (no ledger)", () => {
    let s = started();
    s = { ...s, questDay: { day: DAY, mode: "trading", catalogVersion: 2, core: ["q_walk", "q_meditate", "q_nosocial"], bonus: [] } };
    expect(pendingMissionClaims(s, data({ plans: [plan()] }), t("08:00"))).toBeNull();
    const r = evaluatePlanQuestClosure(s, plan(), [], [plan()], [], t("08:00"));
    expect(r.closedQuests).toEqual(expect.arrayContaining(["q_bias", "q_riskcheck"]));
    expect(r.state.missionLedger).toBeUndefined();
  });
});
