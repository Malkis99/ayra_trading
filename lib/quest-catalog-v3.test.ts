import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  completeQuest,
  completeSelfReportQuest,
  evaluatePlanQuestClosure,
  migrateState,
  modeSetPreview,
  recordJournalTrades,
  replaceQuest,
  setDayMode,
  type GameState,
} from "./game";
import { GameStore } from "./game-store";
import { QUEST_CATALOG_VERSION, REPLACED_BY_MISSIONS, extrasForMode, generateDaySet, type DayMode } from "./quest-engine";
import { CATALOG3_MISSIONS, JOURNAL_CONFIRMED, MISSION_TEMPLATES, QUEST_POOL, getTodaysQuests, isJournalConfirmed, questById, questReward } from "./quests";
import { JOURNAL_LINK } from "./quests-view";
import { MAX_CORE_MISSIONS_PER_DAY, candidateSources, checkMissions, firstTradeDay, isMissionId, missionsForMode, ownText, type MissionData } from "./missions";

/** The missions of a list the saved journal confirms (slot order, one record a mission, three at most). */
const confirmed = (ids: string[], data: MissionData, day: string) =>
  Object.fromEntries(checkMissions(ids.filter(isMissionId), data, day).checks.filter((c) => c.done).map((c) => [c.id, true]));
import { GAME_CONFIG } from "./game-config";
import { ru } from "./i18n/dictionaries/ru";
import type { Note, Trade, TradingPlan } from "./journal/types";

// QH-6.3 (docs/quest-hub-qh6-spec.md, 8): catalog 3 — the three verifiable missions of each mode, self-reports only as
// extras, the study choice fixed for the day, the trading missions closed by the QH-6.2 checks. No new reward.

const at = (iso: string) => new Date(iso);
const DAY = "2026-11-16"; // Monday

function started(day = DAY, extra: Partial<GameState> = {}, zone = "UTC", hhmm = "06:00"): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", lastQuestDate: "2026-11-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: zone }, ...extra } as GameState;
  return checkAndApplyDateResets(base, at(`${day}T${hhmm}:00Z`));
}
/** What a person owns (after the usual day check, which only unlocks titles earned by the profile). */
const wealth = (raw: GameState) => {
  const s = checkAndApplyDateResets(raw, at(`${raw.lastQuestDate}T23:00:00Z`));
  return JSON.stringify([s.xp, s.level, s.coins, s.history.length, s.achievements, s.equipment, s.unlockedTitles, s.currentStreak]);
};
const MODES: DayMode[] = ["trading", "study", "recovery"];

const plan = (over: Partial<TradingPlan> = {}): TradingPlan => ({
  date: DAY,
  bias: [{ instrument: "EURUSD", direction: "bullish" }],
  levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }],
  events: [],
  limits: { maxTrades: 3 },
  checklist: [{ key: "risk_limits_checked", done: true }],
  createdAt: `${DAY}T07:00:00.000Z`,
  updatedAt: `${DAY}T07:00:00.000Z`,
  ...over,
});

describe("QH-6.3 catalog 3: the day set", () => {
  it("every active mode has exactly its three verifiable missions; rest has none; the version is 3", () => {
    expect(QUEST_CATALOG_VERSION).toBe(3);
    for (const mode of MODES) {
      const set = generateDaySet(started(), DAY, mode);
      expect(set.catalogVersion).toBe(3);
      expect(set.core).toHaveLength(MAX_CORE_MISSIONS_PER_DAY);
      expect(set.core).toEqual(missionsForMode(mode, false));
      for (const id of set.core) expect(isJournalConfirmed(id)).toBe(true); // never a self-report with «Mark»
    }
    const rest = generateDaySet(started(), DAY, "rest");
    expect(rest.core).toEqual([]);
    expect(rest.bonus).toEqual([]);
  });

  it("the nine missions are the approved ones; none needs a trade; each is paid at the approved rate (QH-6.4)", () => {
    const all = new Set([...missionsForMode("trading", true), ...missionsForMode("study", true), ...missionsForMode("study", false), ...missionsForMode("recovery", true)]);
    expect([...all].sort()).toEqual(["m_backtest", "m_day_state", "m_lesson", "m_mistake", "m_observation", "m_plan_tomorrow", "m_trade_review", "q_bias", "q_reflect", "q_riskcheck"]);
    expect((all as Set<string>).has("q_tradelog")).toBe(false);
    for (const t of MISSION_TEMPLATES) {
      expect(questReward(t)).toEqual({ xp: GAME_CONFIG.QUEST_XP, coins: GAME_CONFIG.QUEST_COINS });
      expect(QUEST_POOL.some((q) => q.id === t.id)).toBe(false); // never offered as an extra
      expect(questById(t.id)).toBe(t);
    }
  });

  it("extras are self-reports of the mode (two), never a journal check and never the tick-box twin of a mission", () => {
    for (const mode of MODES) {
      const set = generateDaySet(started(), DAY, mode);
      expect(set.bonus).toHaveLength(2);
      const allowed = new Set(extrasForMode(mode).map((q) => q.id));
      for (const id of set.bonus) {
        expect(allowed.has(id)).toBe(true);
        expect(JOURNAL_CONFIRMED.has(id)).toBe(false);
        expect(REPLACED_BY_MISSIONS.has(id)).toBe(false);
      }
    }
  });

  it("the set is made once a day: reloads, a copy of the saved state and later checks give the same set", () => {
    const s = started();
    const again = checkAndApplyDateResets(JSON.parse(JSON.stringify(s)), at(`${DAY}T18:00:00Z`));
    expect(again.questDay).toEqual(s.questDay);
    expect(checkAndApplyDateResets(again, at(`${DAY}T23:59:00Z`)).questDay).toEqual(s.questDay);
    // the next day gets its own set, the closed day goes to the snapshots
    const next = checkAndApplyDateResets(again, at("2026-11-17T06:00:00Z"));
    expect(next.questDay!.day).toBe("2026-11-17");
    expect(next.questDays![0].day).toBe(DAY);
  });

  it("missions are never ticked by hand and never replaced; the extras still are", () => {
    const s = started();
    const before = wealth(s);
    for (const id of [...s.questDay!.core, ...MISSION_TEMPLATES.map((t) => t.id)]) {
      const r = completeSelfReportQuest(s, id, id, "Trading", 999, at(`${DAY}T09:00:00Z`));
      expect(r.xpGiven).toBe(0);
      expect(r.state.completedQuestsToday[id]).toBeUndefined();
      expect(replaceQuest(s, id, [...s.questDay!.core, ...s.questDay!.bonus], at(`${DAY}T09:00:00Z`)).success).toBe(false);
    }
    expect(wealth(s)).toBe(before);
    const extra = s.questDay!.bonus[0];
    expect(completeSelfReportQuest(s, extra, extra, "Mental", 999, at(`${DAY}T09:00:00Z`)).xpGiven).toBeGreaterThan(0);
  });
});

describe("QH-6.3 study: «Trade review» or «Observation», chosen once for the day", () => {
  it("chosen from the journal's earliest trade when the set is made: a trade before the day → review, none → observation", () => {
    expect(generateDaySet(started(DAY, { journalFirstTradeDay: "2026-11-10" }), DAY, "study").core[0]).toBe("m_trade_review");
    expect(generateDaySet(started(DAY, { journalFirstTradeDay: null }), DAY, "study").core[0]).toBe("m_observation");
    // a trade written today is not a past trade
    expect(generateDaySet(started(DAY, { journalFirstTradeDay: DAY }), DAY, "study").core[0]).toBe("m_observation");
    expect(generateDaySet(started(DAY, { journalFirstTradeDay: null }), DAY, "study").studyPending).toBeUndefined();
  });

  it("a set made before the journal reported is settled once; later reports never switch it", () => {
    let s = started(); // no report yet
    expect(s.questDay!.studyPending).toBe(true);
    s = setDayMode(s, "study", at(`${DAY}T07:00:00Z`)).state;
    expect(s.questDay!.core[0]).toBe("m_observation");
    s = recordJournalTrades(s, "2026-11-02", at(`${DAY}T07:01:00Z`)); // the journal is read: it had trades
    expect(s.questDay!.core[0]).toBe("m_trade_review");
    expect(s.questDay!.studyPending).toBeUndefined();
    expect(s.questDay!.studyFirst).toBe("m_trade_review");
    expect(s.journalFirstTradeDay).toBe("2026-11-02");
    // every later report — all trades deleted, a new trade — keeps the day's choice
    s = recordJournalTrades(s, null, at(`${DAY}T12:00:00Z`));
    expect(s.questDay!.core[0]).toBe("m_trade_review");
    s = recordJournalTrades(s, DAY, at(`${DAY}T13:00:00Z`));
    expect(s.questDay!.core[0]).toBe("m_trade_review");
  });

  it("a trade written during the day does not switch «Observation» to «Trade review», in this mode or after a mode change", () => {
    let s = started(DAY, { journalFirstTradeDay: null });
    s = setDayMode(s, "study", at(`${DAY}T07:00:00Z`)).state;
    expect(s.questDay!.core[0]).toBe("m_observation");
    s = recordJournalTrades(s, DAY, at(`${DAY}T11:00:00Z`)); // first trade today
    expect(s.questDay!.core[0]).toBe("m_observation");
    s = setDayMode(s, "trading", at(`${DAY}T12:00:00Z`)).state;
    s = setDayMode(s, "study", at(`${DAY}T13:00:00Z`)).state;
    expect(s.questDay!.core[0]).toBe("m_observation");
    // the next day the trade is a past trade
    s = checkAndApplyDateResets(s, at("2026-11-17T06:00:00Z"));
    expect(generateDaySet(s, "2026-11-17", "study").core[0]).toBe("m_trade_review");
  });

  it("the earliest trade day is counted in the account time zone (a trade at 23:30 in Tbilisi belongs to that day)", () => {
    const t = (createdAt: string, deletedAt?: string) => ({ id: createdAt, createdAt, openedAt: createdAt, deletedAt } as unknown as Trade);
    expect(firstTradeDay([], "UTC")).toBeNull();
    expect(firstTradeDay([t("2026-11-15T19:30:00.000Z")], "Asia/Tbilisi")).toBe("2026-11-15"); // 23:30 local
    expect(firstTradeDay([t("2026-11-15T20:30:00.000Z")], "Asia/Tbilisi")).toBe("2026-11-16"); // 00:30 local
    expect(firstTradeDay([t("2026-11-10T10:00:00.000Z", "2026-11-11T10:00:00.000Z")], "UTC")).toBeNull(); // deleted
  });
});

describe("QH-6.3 mode changes: three missions, paid ones keep their slot, nothing extra", () => {
  it("a done trading mission keeps its slot; the open slots take only the new mode's missions; never more than three", () => {
    let s = started();
    s = completeQuest(s, "q_bias", "Bias", "Trading", GAME_CONFIG.QUEST_XP, GAME_CONFIG.QUEST_COINS, at(`${DAY}T08:00:00Z`)).state;
    const paid = wealth(s);
    for (const m of ["study", "recovery", "rest", "trading", "study", "recovery"] as DayMode[]) {
      s = setDayMode(s, m, at(`${DAY}T09:00:00Z`)).state;
      expect(wealth(s)).toBe(paid); // a mode change gives nothing
      if (m === "rest") continue;
      expect(s.questDay!.core).toHaveLength(3);
      expect(s.questDay!.core[0]).toBe("q_bias");
      for (const id of s.questDay!.core) expect(isJournalConfirmed(id)).toBe(true);
      if (m !== "trading") expect(s.questDay!.core.slice(1)).toEqual(missionsForMode(m, false).slice(1));
    }
  });

  it("a mission put off for today keeps its slot (shown as put off): the day still has three", () => {
    let s = started();
    s = { ...s, passedQuestsToday: { m_lesson: true } };
    s = setDayMode(s, "study", at(`${DAY}T09:00:00Z`)).state;
    expect(s.questDay!.core).toEqual(missionsForMode("study", false));
  });

  it("extras: at most two a day whatever the mode changes — switching after ticking opens no new self-reports", () => {
    let s = started();
    const when = at(`${DAY}T10:00:00Z`);
    for (const id of s.questDay!.bonus) s = completeSelfReportQuest(s, id, id, "Mental", 999, when).state;
    const ticked = Object.keys(s.completedQuestsToday);
    expect(ticked).toHaveLength(2);
    const after = wealth(s);
    for (const m of ["study", "recovery", "trading", "study"] as DayMode[]) {
      s = setDayMode(s, m, at(`${DAY}T11:00:00Z`)).state;
      expect(s.questDay!.bonus.filter((id) => !s.completedQuestsToday[id])).toEqual([]);
      for (const id of s.questDay!.bonus) expect(completeSelfReportQuest(s, id, id, "Mental", 999, at(`${DAY}T11:01:00Z`)).xpGiven).toBe(0);
    }
    expect(wealth(s)).toBe(after);
    // before any extra is done, a mode change offers that mode's extras (choosing a mode stays free)
    let f = started();
    f = setDayMode(f, "recovery", at(`${DAY}T07:00:00Z`)).state;
    for (const id of f.questDay!.bonus) expect(extrasForMode("recovery").some((q) => q.id === id)).toBe(true);
  });

  it("viewing another mode changes nothing", () => {
    const s = started();
    const before = JSON.stringify(s);
    const view = modeSetPreview(s, "recovery", at(`${DAY}T09:00:00Z`));
    expect(JSON.stringify(s)).toBe(before);
    expect(view.core).toEqual(missionsForMode("recovery", false));
  });

  it("the live check never confirms more than three missions a day on the generated sets", () => {
    const data: MissionData = {
      plans: [plan({ review: { rating: 4, followedPlan: "yes", emotions: ["calm"], whatWorked: "Waited for the retest, kept the risk small.", completedAt: `${DAY}T19:00:00.000Z` } })],
      notes: [
        { id: "l1", templateKey: "lesson", body: "Lesson: I wait for the close above the level before I enter.", tags: [], pinned: false, createdAt: `${DAY}T12:00:00.000Z`, updatedAt: `${DAY}T12:00:00.000Z`, archivedAt: null } as Note,
        { id: "w1", templateKey: "weekly_mistake", body: "Mistake: moved the stop twice on Friday. Next time the stop stays where the plan put it.", tags: [], pinned: false, createdAt: `${DAY}T12:05:00.000Z`, updatedAt: `${DAY}T12:05:00.000Z`, archivedAt: null } as Note,
      ],
      trades: [],
      timezone: "UTC",
    };
    for (const mode of MODES) {
      const set = generateDaySet(started(), DAY, mode);
      expect(Object.keys(confirmed(set.core, data, DAY)).length).toBeLessThanOrEqual(3);
    }
    // a broken list of every mission still confirms at most three
    const everything = [...missionsForMode("trading", false), ...missionsForMode("study", false), ...missionsForMode("recovery", false)];
    expect(Object.keys(confirmed(everything, data, DAY)).length).toBeLessThanOrEqual(3);
  });
});

describe("QH-6.3 the trading missions close by the QH-6.2 checks (same rates)", () => {
  const when = at(`${DAY}T08:00:00Z`);
  const close = (p: TradingPlan, s = started()) => evaluatePlanQuestClosure(s, p, [], [p], [], when);

  it("Preparation needs a chosen direction and a level with a price; Risk control needs the standard item", () => {
    expect(close(plan()).closedQuests).toEqual(expect.arrayContaining(["q_bias", "q_riskcheck"]));
    expect(close(plan({ levels: [] })).closedQuests).not.toContain("q_bias");
    expect(close(plan({ levels: [{ label: "POI" }] })).closedQuests).not.toContain("q_bias");
    expect(close(plan({ bias: [{ instrument: "EURUSD" }] })).closedQuests).not.toContain("q_bias"); // a new row: no direction
    expect(close(plan({ checklist: [{ text: "Проверил риск", done: true }] })).closedQuests).not.toContain("q_riskcheck");
    expect(close(plan({ limits: { maxTrades: 0 } })).closedQuests).not.toContain("q_riskcheck");
    // the rate is unchanged
    const r = close(plan());
    expect(r.state.coins - started().coins).toBe(2 * GAME_CONFIG.QUEST_COINS);
  });

  it("a plan made in advance closes Preparation only after today's confirmation (В16); the saved first-save time counts", () => {
    const early = plan({ createdAt: "2026-11-15T20:00:00.000Z", firstSavedAt: "2026-11-15T20:00:05.000Z" });
    expect(close(early).closedQuests).not.toContain("q_bias");
    expect(close({ ...early, prepConfirmedAt: `${DAY}T07:50:00.000Z` }).closedQuests).toContain("q_bias");
    // a draft opened last night and first saved this morning is today's plan
    expect(close(plan({ createdAt: "2026-11-15T22:00:00.000Z", firstSavedAt: `${DAY}T07:40:00.000Z` })).closedQuests).toContain("q_bias");
  });

  it("the plan-discipline XP keeps reading createdAt (old economy unchanged by firstSavedAt)", () => {
    const s = started();
    const trades = [{ id: "t1", openedAt: `${DAY}T09:00:00.000Z` }];
    // created (draft opened) before the first trade, first saved after it: the existing bonus is given as before
    const p = plan({ createdAt: `${DAY}T08:30:00.000Z`, firstSavedAt: `${DAY}T09:30:00.000Z` });
    const r = evaluatePlanQuestClosure(s, p, trades, [p], [], at(`${DAY}T09:30:00Z`));
    expect(r.state.dailyStats[DAY].questsCompleted.discipline_plan).toBe(1);
  });

  it("closing again (a reload, a second tab, the same save) pays once", () => {
    let s = close(plan()).state;
    const once = wealth(s);
    for (let i = 0; i < 3; i++) s = evaluatePlanQuestClosure(s, plan(), [], [plan()], [], when).state;
    expect(wealth(s)).toBe(once);
  });
});

describe("QH-6.3 old saves, rest days, time zones and two tabs", () => {
  it("a catalog-2 day in progress keeps its set and its rewards; a mode change fills open slots with missions", () => {
    let s = started();
    s = { ...s, questDay: { day: DAY, mode: "trading", catalogVersion: 2, core: ["q_walk", "q_meditate", "q_nosocial"], bonus: ["q_gym", "q_read_pages"] } };
    s = completeSelfReportQuest(s, "q_walk", "q_walk", "Physical", 30, at(`${DAY}T09:00:00Z`)).state;
    const paid = wealth(s);
    s = checkAndApplyDateResets(s, at(`${DAY}T10:00:00Z`));
    expect(s.questDay!.catalogVersion).toBe(2); // not regenerated in the middle of the day
    s = setDayMode(s, "study", at(`${DAY}T10:30:00Z`)).state;
    expect(wealth(s)).toBe(paid);
    expect(s.questDay!.core[0]).toBe("q_walk"); // the paid slot stays
    expect(s.questDay!.core.slice(1).every((id) => isJournalConfirmed(id))).toBe(true);
    expect(getTodaysQuests(DAY, {}, s.questDay).core.map((q) => q.id)).toEqual(s.questDay!.core);
  });

  it("a save from before QH-6.3 (no journal report, no catalog-3 fields) migrates without losing anything", () => {
    const old = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", lastQuestDate: "2026-11-15", xp: 120, coins: 55, completedQuestsToday: { q_walk: true }, history: [{ questId: "q_walk", questTitle: "Walk", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-15" }], profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" } } as unknown as GameState;
    delete (old as Partial<GameState>).journalFirstTradeDay;
    const s = checkAndApplyDateResets(migrateState(JSON.parse(JSON.stringify(old))), at(`${DAY}T06:00:00Z`));
    expect(s.xp).toBe(120);
    expect(s.coins).toBe(55);
    expect(s.history).toHaveLength(1);
    expect(s.questDays![0].day).toBe("2026-11-15"); // yesterday's snapshot is written as before
    expect(s.questDay!.catalogVersion).toBe(3);
    expect(s.questDay!.studyPending).toBe(true); // settled when the journal reports
  });

  it("a rest day has no missions and nothing «not done»; leaving it gives the mode's missions back", () => {
    let s = setDayMode(started(), "rest", at(`${DAY}T08:00:00Z`)).state;
    expect(s.isRestDay).toBe(true);
    const shown = getTodaysQuests(DAY, s.questReplacements, s.questDay);
    expect(modeSetPreview(s, "rest", at(`${DAY}T08:00:00Z`)).core).toEqual([]);
    expect(missionsForMode("rest", true)).toEqual([]);
    s = setDayMode(s, "trading", at(`${DAY}T09:00:00Z`)).state;
    expect(s.questDay!.core).toEqual(missionsForMode("trading", false));
    expect(shown.core.length).toBeGreaterThanOrEqual(0);
  });

  it("the game day follows the account time zone: the set changes at local midnight, once", () => {
    // Tbilisi = UTC+4: 19:59 UTC is 23:59 on 11-16, 20:01 UTC is 00:01 on 11-17
    let s = started(DAY, { journalFirstTradeDay: null }, "Asia/Tbilisi", "05:00");
    expect(s.questDay!.day).toBe(DAY);
    s = checkAndApplyDateResets(s, at(`${DAY}T19:59:00Z`));
    expect(s.questDay!.day).toBe(DAY);
    s = checkAndApplyDateResets(s, at(`${DAY}T20:01:00Z`));
    expect(s.questDay!.day).toBe("2026-11-17");
    expect(s.questDays!.filter((d) => d.day === DAY)).toHaveLength(1);
  });

  it("two tabs after midnight: one set for the day, the same in both; the journal report settles it once", async () => {
    let s = started(DAY, {}, "UTC");
    const saved = { raw: JSON.stringify(s) };
    const now = at("2026-11-17T08:00:00Z");
    const tab = () => {
      const store = new GameStore<GameState>({ read: () => saved.raw, write: (raw) => ((saved.raw = raw), true), parse: (raw) => checkAndApplyDateResets(JSON.parse(raw), now) });
      store.noteLoaded(saved.raw);
      return store;
    };
    const a = tab();
    const b = tab();
    await a.applyLocked(() => s, (fresh) => ({ state: checkAndApplyDateResets(fresh, now), result: null }));
    await b.applyLocked(() => s, (fresh) => ({ state: checkAndApplyDateResets(fresh, now), result: null }));
    const first = JSON.parse(saved.raw) as GameState;
    expect(first.questDay!.day).toBe("2026-11-17");
    await a.applyLocked(() => s, (fresh) => ({ state: recordJournalTrades(fresh, "2026-11-01", now), result: null }));
    const settled = JSON.parse(saved.raw) as GameState;
    await b.applyLocked(() => s, (fresh) => ({ state: recordJournalTrades(fresh, null, now), result: null }));
    s = JSON.parse(saved.raw) as GameState;
    expect(s.questDay!.studyFirst).toBe(settled.questDay!.studyFirst); // the second report does not switch it
    expect(s.questDays!.filter((d) => d.day === DAY)).toHaveLength(1);
  });
});

describe("QH-6.3 links, texts and no new rewards", () => {
  it("every mission's «Go» leads to its journal place", () => {
    expect(JOURNAL_LINK.q_bias).toBe("/journal?tab=plan&focus=bias");
    expect(JOURNAL_LINK.q_riskcheck).toBe("/journal?tab=plan&focus=limits");
    expect(JOURNAL_LINK.q_reflect).toBe("/journal?tab=plan&focus=review");
    expect(JOURNAL_LINK.m_trade_review).toBe("/journal?tab=trades");
    expect(JOURNAL_LINK.m_observation).toBe("/journal?tab=notes&new=idea");
    expect(JOURNAL_LINK.m_backtest).toBe("/journal?tab=notes&new=backtest");
    expect(JOURNAL_LINK.m_lesson).toBe("/journal?tab=notes&new=lesson");
    expect(JOURNAL_LINK.m_day_state).toBe("/journal?tab=plan&focus=review");
    expect(JOURNAL_LINK.m_mistake).toBe("/journal?tab=notes&new=weekly_mistake");
    expect(JOURNAL_LINK.m_plan_tomorrow).toBe("/journal?tab=plan&day=tomorrow");
    for (const id of CATALOG3_MISSIONS) {
      expect(ru.questsPage.q2.criteria[id as keyof typeof ru.questsPage.q2.criteria]).toBeTruthy();
      expect(ru.questsPage.q2.journalCta[id as keyof typeof ru.questsPage.q2.journalCta]).toBeTruthy();
    }
  });

  it("an untouched note template is the form's text, not the person's: it confirms no mission", () => {
    expect(ownText(ru.journal.notes.templateBodyIdea).trim()).toBe("");
    const untouched: Note = { id: "i1", templateKey: "idea", body: ru.journal.notes.templateBodyIdea, tags: [], pinned: false, createdAt: `${DAY}T12:00:00.000Z`, updatedAt: `${DAY}T12:00:00.000Z`, archivedAt: null };
    const d: MissionData = { plans: [], notes: [untouched], trades: [], timezone: "UTC" };
    expect(candidateSources("m_observation", d, DAY)).toEqual([]);
    const filled = { ...untouched, body: ru.journal.notes.templateBodyIdea.replace("Инструмент и сценарий:", "Инструмент и сценарий: EURUSD, ложный пробой азиатского максимума и возврат в диапазон") };
    expect(candidateSources("m_observation", { ...d, notes: [filled] }, DAY)).toEqual(["note:i1"]);
  });

  it("the journal report gives nothing: no XP, no Coins, no history", () => {
    const s = started();
    const before = wealth(s);
    expect(wealth(recordJournalTrades(s, "2026-11-01", at(`${DAY}T09:00:00Z`)))).toBe(before);
    expect(wealth(recordJournalTrades(s, null, at(`${DAY}T09:00:00Z`)))).toBe(before);
  });
});
