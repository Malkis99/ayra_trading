/**
 * Quest Engine 2.0 (docs/quests-2.0-plan.md, section 2; Q2).
 *
 * Three layers:
 * 1. QuestDefinition — the catalog (versioned): every quest of the pool plus the composite missions, with its kind,
 *    the day modes it fits, and how it is confirmed (by the journal or by the person).
 * 2. QuestInstance — what a person got: the day set is generated once and saved in the game state (`questDay`), the week
 *    challenge once per week (`questWeek`); evaluators below give each its real status from the journal.
 * 3. RewardService — lib/reward-service.ts, the one adapter to the existing Q1 rewards.
 *
 * Nothing here gives a reward or introduces a new rate: composite missions and week missions show progress from the
 * journal; the quests the app checks keep closing by the existing rules (lib/game.ts), self-reported ones give their
 * existing XP. Week missions and the Weekly Boss give nothing yet (owner decision 0.7).
 */
import { generateProgram, type AwakeningProgram } from "./awakening";
import { addDaysToKey, dayKeyInZone, mondayOfKey, weekdayOfKey } from "./day-key";
import { APP_CLOSED_QUESTS, QUEST_POOL, getDeterministicDailyQuests, getWeightedDailyQuests, type QuestTemplate } from "./quests";

/** Bumped when the catalog or the generation rules change; saved with each generated set. */
export const QUEST_CATALOG_VERSION = 2;

export type DayMode = "trading" | "study" | "rest" | "recovery";
export const DAY_MODES: DayMode[] = ["trading", "study", "rest", "recovery"];

/** Quests that need a trade are never offered (owner: no quest may require a trade). q_tradelog still closes by itself. */
export const NEVER_OFFERED: ReadonlySet<string> = new Set(["q_tradelog"]);

/** Quests that fit a study day (learning, research, review) — taken from the existing pool, no new quests or rates. */
const STUDY_IDS: ReadonlySet<string> = new Set([
  "q_backtest",
  "q_review_mistake",
  "q_logic_puzzle",
  "q_read_pages",
  "q_lang_study",
  "q_lang_10m",
  "q_screenplan",
  "q_reflect",
  "q_community_post",
]);

/** Light quests for a recovery day (after losses or a break): calm, no pressure, nothing about trading results. */
const RECOVERY_IDS: ReadonlySet<string> = new Set(["q_meditate", "q_walk", "q_stretching", "q_sleep_prep", "q_review_mistake", "q_reflect", "q_read_pages"]);

export type QuestKind = "daily" | "composite";
export type Confirmation = "journal" | "self";

export interface QuestDefinition {
  id: string;
  kind: QuestKind;
  confirmation: Confirmation;
  modes: DayMode[];
  /** Pool quest behind it (daily quests); composite missions group several. */
  template?: QuestTemplate;
  /** Quests whose existing rewards a composite mission shows (it adds no reward of its own). */
  includes?: string[];
}

function modesOf(id: string): DayMode[] {
  const modes: DayMode[] = ["trading"];
  if (STUDY_IDS.has(id)) modes.push("study");
  if (RECOVERY_IDS.has(id)) modes.push("recovery");
  return modes;
}

/** The catalog: every pool quest plus the two composite missions of a trading day. */
export const QUEST_CATALOG: QuestDefinition[] = [
  ...QUEST_POOL.filter((q) => !NEVER_OFFERED.has(q.id)).map((q) => ({
    id: q.id,
    kind: "daily" as const,
    confirmation: (APP_CLOSED_QUESTS.has(q.id) ? "journal" : "self") as Confirmation,
    modes: modesOf(q.id),
    template: q,
  })),
  { id: "morning_protocol", kind: "composite", confirmation: "journal", modes: ["trading"], includes: ["q_bias", "q_riskcheck"] },
  { id: "eod_ritual", kind: "composite", confirmation: "journal", modes: ["trading", "study"], includes: ["q_reflect"] },
];

/** Pool quests that may be offered in a mode. */
export function poolForMode(mode: DayMode): QuestTemplate[] {
  if (mode === "rest") return [];
  return QUEST_CATALOG.filter((d) => d.kind === "daily" && d.modes.includes(mode)).map((d) => d.template!);
}

/* ------------------------------------------------------------------ schedule and day set */

/** 0 = Monday … 6 = Sunday. Without a choice every day is a trading day (the same behaviour as before Q2). */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function isTradingDay(dayKey: string, tradingDays: number[] | undefined): boolean {
  const days = Array.isArray(tradingDays) && tradingDays.length > 0 ? tradingDays : ALL_DAYS;
  return days.includes(weekdayOfKey(dayKey));
}

/** The mode a day starts in: trading on a trading day, study on the others. */
export function defaultModeFor(dayKey: string, tradingDays: number[] | undefined): DayMode {
  return isTradingDay(dayKey, tradingDays) ? "trading" : "study";
}

export interface DaySet {
  day: string;
  mode: DayMode;
  /** The mode to go back to after a rest. */
  modeBeforeRest?: DayMode;
  catalogVersion: number;
  core: string[];
  bonus: string[];
  /** The set of a day that had begun before Q2: kept as Q1 computed it, so nothing changes in the middle of a day. */
  legacy?: boolean;
  /** Core quests done in another mode earlier today and kept in their slot after a mode change (quest id → that mode). */
  carried?: Record<string, DayMode>;
  /** QH-3 tracking for the day snapshot (lib/day-snapshots.ts): every quest the active set showed today. Absent on a set
   * saved by an older version (that day is then marked incomplete, nothing is guessed). */
  offered?: string[];
  /** Mode changes of the day (QH-3 tracking). */
  modeChanges?: Array<{ to: DayMode; at: string }>;
  /** Replacements of the day, kept across mode changes (QH-3 tracking). */
  replaced?: Array<{ from: string; to: string }>;
}

/** The program of the onboarding answers (the same rules as the Awakening finale), or null without a finished onboarding. */
export function programFor(state: { onboarding?: { status?: string; answers?: Record<string, unknown> }; profile?: { minorMode?: boolean } }): AwakeningProgram | null {
  if (state.onboarding?.status !== "done") return null;
  return generateProgram((state.onboarding.answers || {}) as Record<string, unknown>, !!state.profile?.minorMode);
}

/**
 * The day's quests for a mode: weighted by the onboarding program (getWeightedDailyQuests), only quests that fit the mode,
 * never a quest that needs a trade. Deterministic for the person, the day and the mode.
 */
export function generateDaySet(
  state: { createdAt?: string; onboarding?: { status?: string; answers?: Record<string, unknown> }; profile?: { minorMode?: boolean } },
  dayKey: string,
  mode: DayMode
): DaySet {
  const pool = poolForMode(mode);
  const program = programFor(state);
  const seed = (state.createdAt || "user_default").slice(0, 10);
  const picked = pool.length ? (program ? getWeightedDailyQuests(dayKey, seed, program, pool) : getDeterministicDailyQuests(dayKey, pool)) : { core: [], bonus: [] };
  return { day: dayKey, mode, catalogVersion: QUEST_CATALOG_VERSION, core: picked.core.map((q) => q.id), bonus: picked.bonus.map((q) => q.id) };
}

/**
 * The set of a new active mode in the middle of a day (docs/quests-ux-3.0-plan.md, 6). The core list is three slots:
 * a slot already done keeps its quest (and its reward, paid once), so a mode change never erases work and never opens
 * a second reward for the same slot. Open slots take the new mode's quests; a quest is never in two slots, and quests put
 * off for today («not today», replaced) are not offered again.
 */
export function composeSwitchedSet(
  current: { core: string[]; mode: DayMode; carried?: Record<string, DayMode> },
  fresh: DaySet,
  done: Record<string, boolean>,
  passed: Record<string, boolean>
): DaySet {
  const slots = Math.max(current.core.length, fresh.core.length);
  const core: Array<string | undefined> = new Array(slots).fill(undefined);
  const used = new Set<string>();
  const carried: Record<string, DayMode> = {};
  current.core.forEach((id, i) => {
    if (!done[id]) return;
    core[i] = id;
    used.add(id);
    const from = current.carried?.[id] ?? current.mode;
    if (from !== fresh.mode) carried[id] = from;
  });
  const free = (id: string) => !used.has(id) && (!passed[id] || !!done[id]);
  const candidates = [...fresh.core, ...fresh.bonus, ...poolForMode(fresh.mode).map((q) => q.id)];
  for (let i = 0; i < slots; i++) {
    if (core[i]) continue;
    const pick = [fresh.core[i], ...candidates].find((id) => !!id && free(id));
    if (!pick) continue;
    core[i] = pick;
    used.add(pick);
  }
  const set: DaySet = { ...fresh, core: core.filter((id): id is string => !!id), bonus: fresh.bonus.filter((id) => !used.has(id)) };
  if (Object.keys(carried).length > 0) set.carried = carried;
  return set;
}

/** The Q1 set of a day that had already begun (kept unchanged for that day). */
export function legacyDaySet(dayKey: string, mode: DayMode): DaySet {
  const q = getDeterministicDailyQuests(dayKey);
  return { day: dayKey, mode, catalogVersion: 1, core: q.core.map((x) => x.id), bonus: q.bonus.map((x) => x.id), legacy: true };
}

/* ------------------------------------------------------------------ journal snapshot and evaluators */

/** What the engine reads from the journal (structural types: no dependency on the journal module). */
export interface JTrade {
  id: string;
  openedAt: string;
  status?: string;
  stopLoss?: number;
  riskAmount?: number;
  riskPercent?: number;
  entryReason?: string;
  emotions?: string[];
  mistakes?: string[];
  executionRating?: number;
  deletedAt?: string | null;
}
export interface JPlan {
  date: string;
  bias?: Array<{ instrument?: string }>;
  levels?: unknown[];
  events?: unknown[];
  limits?: { maxRiskPerTrade?: { value?: number | null } | null; maxDailyLoss?: { value?: number | null } | null; maxTrades?: number | null } | null;
  checklist?: Array<{ key?: string; text?: string; done?: boolean }>;
  review?: { completedAt?: string | null; whatWorked?: string; whatToImprove?: string; lesson?: string } | null;
  createdAt?: string;
  deletedAt?: string | null;
}
export interface JWeekPlan {
  weekStartDate: string;
  goals?: string[];
  summary?: string;
  deletedAt?: string | null;
}
export interface JNoTrade {
  id: string;
  date: string;
  reason?: string;
  deletedAt?: string | null;
}
export interface JournalSnapshot {
  trades: JTrade[];
  plans: JPlan[];
  weekPlans: JWeekPlan[];
  noTrades: JNoTrade[];
  timezone?: string;
}

const alive = <T extends { deletedAt?: string | null }>(xs: T[] | undefined) => (xs || []).filter((x) => !x.deletedAt);
const tradeDay = (t: JTrade, tz?: string) => dayKeyInZone(new Date(t.openedAt), tz);

export function planFor(snap: JournalSnapshot, dayKey: string): JPlan | null {
  return alive(snap.plans).find((p) => p.date === dayKey) || null;
}

/** The same checks lib/game.ts uses to close the plan quests (kept in one place for the reasons shown on screen). */
export const planChecks = {
  bias: (p: JPlan | null) => !!p && Array.isArray(p.bias) && p.bias.some((b) => !!b.instrument && b.instrument.trim().length > 0),
  limits: (p: JPlan | null) => !!p && (p.limits?.maxRiskPerTrade?.value != null || p.limits?.maxDailyLoss?.value != null || p.limits?.maxTrades != null),
  riskChecked: (p: JPlan | null) =>
    !!p && Array.isArray(p.checklist) && p.checklist.some((c) => (c.key === "risk_limits_checked" || (c.text || "").toLowerCase().includes("риск")) && !!c.done),
  levels: (p: JPlan | null) => !!p && Array.isArray(p.levels) && p.levels.length > 0,
  events: (p: JPlan | null) => !!p && Array.isArray(p.events) && p.events.length > 0,
  reviewText: (p: JPlan | null) => (p?.review?.whatWorked || "").length + (p?.review?.whatToImprove || "").length + (p?.review?.lesson || "").length,
  reviewDone: (p: JPlan | null) => !!p?.review?.completedAt && planChecks.reviewText(p) >= 40,
};

/** Why a quest is not done yet — a key for the dictionary (`null` when it is done). */
export type ReasonKey =
  | "selfReport"
  | "noPlan"
  | "noBias"
  | "noLimits"
  | "riskNotChecked"
  | "noReview"
  | "restDay"
  | "notThisMode";

export function reasonFor(questId: string, done: boolean, snap: JournalSnapshot, dayKey: string): ReasonKey | null {
  if (done) return null;
  if (!APP_CLOSED_QUESTS.has(questId)) return "selfReport";
  const plan = planFor(snap, dayKey);
  if (questId === "q_bias") return !plan ? "noPlan" : "noBias";
  if (questId === "q_riskcheck") return !plan ? "noPlan" : !planChecks.limits(plan) ? "noLimits" : "riskNotChecked";
  if (questId === "q_reflect") return !plan ? "noPlan" : "noReview";
  return "selfReport";
}

export type StepState = "done" | "open";
export interface MissionStep {
  key: "bias" | "levels" | "calendar" | "risk" | "review";
  state: StepState;
  /** The pool quest whose existing reward this step closes (none: the step only shows progress). */
  rewardQuest?: string;
}

/** Morning protocol: Daily Bias → levels → calendar in the plan → risk. Rewards: only those of q_bias and q_riskcheck. */
export function morningProtocol(snap: JournalSnapshot, dayKey: string, completed: Record<string, boolean>): { steps: MissionStep[]; hasPlan: boolean } {
  const plan = planFor(snap, dayKey);
  return {
    hasPlan: !!plan,
    steps: [
      { key: "bias", state: completed.q_bias || planChecks.bias(plan) ? "done" : "open", rewardQuest: "q_bias" },
      { key: "levels", state: planChecks.levels(plan) ? "done" : "open" },
      { key: "calendar", state: planChecks.events(plan) ? "done" : "open" },
      { key: "risk", state: completed.q_riskcheck || (planChecks.limits(plan) && planChecks.riskChecked(plan)) ? "done" : "open", rewardQuest: "q_riskcheck" },
    ],
  };
}

/** End-of-day ritual: the day review in the plan (the existing q_reflect closes from it). */
export function endOfDayRitual(snap: JournalSnapshot, dayKey: string, completed: Record<string, boolean>): { steps: MissionStep[]; hasPlan: boolean } {
  const plan = planFor(snap, dayKey);
  return { hasPlan: !!plan, steps: [{ key: "review", state: completed.q_reflect || planChecks.reviewDone(plan) ? "done" : "open", rewardQuest: "q_reflect" }] };
}

/** «No trade» entries of the game day (a conscious skip is discipline; it is rewarded by the journal's existing rule). */
export function noTradesOn(snap: JournalSnapshot, dayKey: string): number {
  return alive(snap.noTrades).filter((n) => (n.date || "").slice(0, 10) === dayKey).length;
}

/* ------------------------------------------------------------------ week missions */

export type CheckState = "met" | "notMet" | "notApplicable" | "insufficientData" | "pending";

export interface WeekObjective {
  key: "reviewTrades" | "planBeforeTrades" | "tradeLimit" | "weekReview";
  state: CheckState;
  done: number;
  total: number;
}

export function weekRange(dayKey: string): { start: string; end: string; days: string[] } {
  const start = mondayOfKey(dayKey);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i));
  return { start, end: days[6], days };
}

function weekTrades(snap: JournalSnapshot, dayKey: string): JTrade[] {
  const { start, end } = weekRange(dayKey);
  return alive(snap.trades).filter((t) => {
    const d = tradeDay(t, snap.timezone);
    return d >= start && d <= end;
  });
}

const isReviewed = (t: JTrade) => !!(t.entryReason && t.entryReason.trim()) && (t.emotions || []).length > 0 && t.executionRating != null;

/** Real week objectives from the journal; none is counted as failed for a week without trades. */
export function weekObjectives(snap: JournalSnapshot, dayKey: string): WeekObjective[] {
  const trades = weekTrades(snap, dayKey);
  const closed = trades.filter((t) => t.status !== "open");
  const reviewed = closed.filter(isReviewed).length;

  const byDay = new Map<string, JTrade[]>();
  for (const t of trades) {
    const d = tradeDay(t, snap.timezone);
    byDay.set(d, [...(byDay.get(d) || []), t]);
  }
  let planned = 0;
  let limitDays = 0;
  let withinLimit = 0;
  for (const [d, ts] of byDay) {
    const plan = planFor(snap, d);
    const first = Math.min(...ts.map((t) => new Date(t.openedAt).getTime()));
    if (plan && plan.createdAt && new Date(plan.createdAt).getTime() <= first && planChecks.bias(plan) && planChecks.limits(plan)) planned++;
    const max = plan?.limits?.maxTrades;
    if (typeof max === "number") {
      limitDays++;
      if (ts.length <= max) withinLimit++;
    }
  }
  const week = alive(snap.weekPlans).find((w) => w.weekStartDate === weekRange(dayKey).start);

  const ratio = (done: number, total: number): CheckState => (total === 0 ? "notApplicable" : done === total ? "met" : "notMet");
  return [
    { key: "reviewTrades", state: ratio(reviewed, closed.length), done: reviewed, total: closed.length },
    { key: "planBeforeTrades", state: ratio(planned, byDay.size), done: planned, total: byDay.size },
    {
      key: "tradeLimit",
      state: byDay.size === 0 ? "notApplicable" : limitDays === 0 ? "insufficientData" : ratio(withinLimit, limitDays),
      done: withinLimit,
      total: limitDays,
    },
    { key: "weekReview", state: week?.summary && week.summary.trim() ? "met" : "pending", done: week?.summary?.trim() ? 1 : 0, total: 1 },
  ];
}

/** The goals the person set in the journal's week plan (shown as they are: no invented progress). */
export function weekGoals(snap: JournalSnapshot, dayKey: string): string[] {
  const week = alive(snap.weekPlans).find((w) => w.weekStartDate === weekRange(dayKey).start);
  return (week?.goals || []).map((g) => g.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ Weekly Boss (quality of decisions, no rewards yet) */

export type BossId = "noFomo" | "respectStop" | "riskGuardian" | "followPlan" | "patience" | "journalConsistency";

/** Which mistake of last week chooses which challenge (the most frequent one wins; ties by this order). */
const BOSS_BY_MISTAKE: Array<[BossId, string[]]> = [
  ["respectStop", ["moved_stop", "no_stop"]],
  ["noFomo", ["fomo"]],
  ["riskGuardian", ["oversized"]],
  ["followPlan", ["ignored_plan", "news_ignored"]],
  ["patience", ["early_entry", "overtrading", "revenge_trade"]],
];

/** The challenge of the week, chosen from last week's mistakes; without them — journal consistency. */
export function pickBoss(snap: JournalSnapshot, dayKey: string): BossId {
  const prevWeekDay = addDaysToKey(mondayOfKey(dayKey), -1);
  const counts = new Map<BossId, number>();
  for (const t of weekTrades(snap, prevWeekDay)) {
    for (const m of t.mistakes || []) {
      const hit = BOSS_BY_MISTAKE.find(([, ms]) => ms.includes(m));
      if (hit) counts.set(hit[0], (counts.get(hit[0]) || 0) + 1);
    }
  }
  let best: BossId = "journalConsistency";
  let bestN = 0;
  for (const [id] of BOSS_BY_MISTAKE) {
    const n = counts.get(id) || 0;
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

export interface BossCondition {
  key: string;
  /** auto: from journal data; self: from the person's own marks (mistake tags). */
  source: "auto" | "self";
  state: CheckState;
  done: number;
  total: number;
}

function perTrade(trades: JTrade[], ok: (t: JTrade) => boolean, key: string, source: "auto" | "self"): BossCondition {
  const done = trades.filter(ok).length;
  return { key, source, state: trades.length === 0 ? "notApplicable" : done === trades.length ? "met" : "notMet", done, total: trades.length };
}

const hasNone = (...ms: string[]) => (t: JTrade) => !(t.mistakes || []).some((m) => ms.includes(m));
const hasRisk = (t: JTrade) => t.stopLoss != null || t.riskAmount != null || t.riskPercent != null;

/** The challenge's conditions on this week's trades. No trades → «not applicable», never failed. */
export function bossConditions(boss: BossId, snap: JournalSnapshot, dayKey: string): BossCondition[] {
  const trades = weekTrades(snap, dayKey);
  const objectives = weekObjectives(snap, dayKey);
  const fromObjective = (key: WeekObjective["key"], name: string): BossCondition => {
    const o = objectives.find((x) => x.key === key)!;
    return { key: name, source: "auto", state: o.state === "pending" ? "notMet" : o.state, done: o.done, total: o.total };
  };
  switch (boss) {
    case "noFomo":
      return [perTrade(trades, hasNone("fomo"), "noFomoTag", "self"), perTrade(trades, (t) => !!t.entryReason?.trim(), "entryReason", "auto")];
    case "respectStop":
      return [perTrade(trades, hasRisk, "stopSet", "auto"), perTrade(trades, hasNone("moved_stop", "no_stop"), "stopNotMoved", "self")];
    case "riskGuardian":
      return [perTrade(trades, hasRisk, "riskSet", "auto"), perTrade(trades, hasNone("oversized"), "noOversize", "self")];
    case "followPlan":
      return [fromObjective("planBeforeTrades", "planFirst"), perTrade(trades, hasNone("ignored_plan"), "noIgnoredPlan", "self")];
    case "patience":
      return [perTrade(trades, hasNone("early_entry", "overtrading", "revenge_trade"), "noImpulse", "self"), fromObjective("tradeLimit", "withinLimit")];
    case "journalConsistency":
    default:
      return [fromObjective("reviewTrades", "tradesReviewed")];
  }
}

/** The challenge's overall state: «not applicable» without trades, otherwise met only when every applicable condition is met. */
export function bossState(conditions: BossCondition[]): CheckState {
  const applicable = conditions.filter((c) => c.state !== "notApplicable");
  if (applicable.length === 0) return "notApplicable";
  if (applicable.every((c) => c.state === "insufficientData")) return "insufficientData";
  return applicable.every((c) => c.state === "met" || c.state === "insufficientData") ? "met" : "notMet";
}

export interface WeekChallenge {
  week: string;
  boss: BossId;
}

/** Trades of last week the choice is based on (0: nothing to base it on — the choice is not saved, it is computed). */
export function lastWeekTradeCount(snap: JournalSnapshot, dayKey: string): number {
  return weekTrades(snap, addDaysToKey(mondayOfKey(dayKey), -1)).length;
}

/** The week's challenge: the saved one for this week, else the one chosen from last week's data now. */
export function currentBoss(saved: WeekChallenge | undefined, snap: JournalSnapshot, dayKey: string): BossId {
  const week = mondayOfKey(dayKey);
  return saved && saved.week === week ? saved.boss : pickBoss(snap, dayKey);
}
