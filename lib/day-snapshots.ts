/**
 * Snapshots of closed game days and weeks (docs/quest-hub-plan.md, 5). A past day can later be shown as it was.
 *
 * - A day snapshot is written once, when the next game day starts (lib/game.ts, checkAndApplyDateResets), from the
 *   state of that day before it is cleared. A snapshot that exists is never written again or edited.
 * - Snapshots are read-only: no reward function reads them, so nothing can be given again for a past day.
 * - Nothing is invented: a day the person did not open has no snapshot; what was not tracked on a day (a day that began
 *   before this version) is listed in `incomplete` instead of being guessed.
 * - Detailed snapshots are kept for DAY_SNAPSHOT_RETENTION_DAYS (owner decision В2, 2026-11-13); dropping an old
 *   snapshot never touches `history`, `dailyStats`, rewards or achievements.
 *
 * Structural types only (no import from lib/game.ts): the game rules call these helpers, not the other way round.
 */
import { APP_CLOSED_QUESTS, getTodaysQuests } from "./quests";
import { addDaysToKey, mondayOfKey } from "./day-key";
import { DAY_MODES, type BossId, type CheckState, type DayMode, type DaySet } from "./quest-engine";

export const SNAPSHOT_VERSION = 1;
/** How long detailed day snapshots are kept on the device (owner decision В2). */
export const DAY_SNAPSHOT_RETENTION_DAYS = 120;

export interface ModeChange {
  to: DayMode;
  at: string;
}

export interface DoneEntry {
  /** Exact time (ISO), when the day's history has it. */
  at?: string;
  /** What the history recorded for it (absent: the quest was done but no history entry exists). */
  xp?: number;
  coins?: number;
  source: "journal" | "self";
  /** The mode it was done in, when known (a core quest kept after a mode change). */
  mode?: DayMode;
}

/** Parts of a day that were not tracked (the day began before snapshots, or its set was not saved). */
export type SnapshotGap = "set" | "offered" | "modeChanges";

export interface DaySnapshot {
  v: 1;
  /** Game day YYYY-MM-DD (account time zone). */
  day: string;
  /** The active mode at the end of the day (absent when the day's set was not saved). */
  mode?: DayMode;
  modeBeforeRest?: DayMode;
  catalogVersion?: number;
  /** The three slots and the extras as shown at the end of the day (replacements followed). */
  core: string[];
  bonus: string[];
  /** Every quest shown in the active set during the day: first set, replacements, mode changes. */
  offered: string[];
  done: Record<string, DoneEntry>;
  /** «Not today» (a replaced quest is in `replaced`, not here). */
  passed: string[];
  replaced: Array<{ from: string; to: string }>;
  modeChanges: ModeChange[];
  restDay: boolean;
  shieldUsed: boolean;
  /** The day's totals as the day statistics recorded them (every source of the day, not only quests). */
  totals: { xp: number; coins: number; selfXp: number; quests: number };
  /** What this snapshot cannot show (honest: not guessed). */
  incomplete?: SnapshotGap[];
  /** When it was written (ISO). */
  recordedAt: string;
}

export interface WeekSnapshot {
  v: 1;
  /** Monday of the week (game days). */
  week: string;
  /** The week challenge chosen for it, if one was. */
  boss?: BossId;
  /** The challenge's result by the journal, written once in the next week (no reward: owner decision 5). */
  bossResult?: { state: CheckState; conditions: Array<{ key: string; source: "auto" | "self"; state: CheckState; done: number; total: number }>; at: string };
  /** Days of the week that have a day snapshot. */
  daysRecorded: string[];
  totals: { xp: number; coins: number; quests: number };
  recordedAt: string;
}

/* ------------------------------------------------------------------ tracking during the day (inside questDay) */

const uniq = (ids: string[]) => Array.from(new Set(ids));

/** A new day set starts its tracking: what it offers now. */
export function startTracking(set: DaySet): DaySet {
  return { ...set, offered: uniq([...set.core, ...set.bonus]), modeChanges: [], replaced: [] };
}

/** The set after a mode change keeps the day's tracking and adds what the new set offers and the change itself. */
export function trackModeChange(prev: DaySet | undefined, next: DaySet, to: DayMode, at: Date): DaySet {
  if (!prev || !Array.isArray(prev.offered)) {
    // the day began before tracking: nothing earlier is known, so nothing is claimed
    const { offered: _o, modeChanges: _m, replaced: _r, ...rest } = next;
    return prev?.replaced ? { ...rest, replaced: prev.replaced } : rest;
  }
  return {
    ...next,
    offered: uniq([...prev.offered, ...next.core, ...next.bonus]),
    modeChanges: [...(prev.modeChanges || []), { to, at: at.toISOString() }],
    replaced: prev.replaced || [],
  };
}

/** A replacement on the saved set: the new quest is offered too. */
export function trackReplacement(set: DaySet | undefined, from: string, to: string): DaySet | undefined {
  if (!set) return set;
  return {
    ...set,
    offered: Array.isArray(set.offered) ? uniq([...set.offered, to]) : set.offered,
    replaced: [...(set.replaced || []), { from, to }],
  };
}

/* ------------------------------------------------------------------ the day snapshot */

/** What a closing day is made of (the game state before the day change clears it). */
export interface ClosingDay {
  lastQuestDate: string;
  questDay?: DaySet;
  isRestDay: boolean;
  completedQuestsToday: Record<string, boolean>;
  passedQuestsToday?: Record<string, boolean>;
  questReplacements?: Record<string, string>;
  history: Array<{ questId: string; xp: number; coins: number; completedAt: string; at?: string }>;
  dailyStats: Record<string, { xpGained?: number; coinsGained?: number; totalQuestsCompleted?: number; isRestDay?: boolean } | undefined>;
}

/** The snapshot of the day that is closing. `shieldUsed`: the day change spent a shield for this day. */
export function buildDaySnapshot(s: ClosingDay, shieldUsed: boolean, at: Date): DaySnapshot {
  const day = s.lastQuestDate;
  const qd = s.questDay && s.questDay.day === day ? s.questDay : undefined;
  const replacements = s.questReplacements || {};
  const incomplete: SnapshotGap[] = [];

  let core: string[] = [];
  let bonus: string[] = [];
  if (qd) {
    const shown = getTodaysQuests(day, replacements, qd);
    core = shown.core.map((q) => q.id);
    bonus = shown.bonus.map((q) => q.id);
  } else {
    incomplete.push("set");
  }

  // replacements: tracked on the set, plus today's map (a mode change folds the map into the set)
  const replaced = [...(qd?.replaced || [])];
  for (const [from, to] of Object.entries(replacements)) {
    if (!replaced.some((r) => r.from === from && r.to === to)) replaced.push({ from, to });
  }
  const replacedFrom = new Set(replaced.map((r) => r.from));

  const tracked = !!qd && Array.isArray(qd.offered);
  const offered = tracked ? uniq([...(qd!.offered as string[]), ...core, ...bonus, ...replaced.map((r) => r.to)]) : [];
  if (!tracked) incomplete.push("offered", "modeChanges");

  // the last history entry of the day per quest (a quest is done once a day; the latest wins if a copy exists)
  const entries = new Map<string, ClosingDay["history"][number]>();
  for (const h of s.history || []) if (h.completedAt === day) entries.set(h.questId, h);
  const done: Record<string, DoneEntry> = {};
  for (const [id, yes] of Object.entries(s.completedQuestsToday || {})) {
    if (!yes) continue;
    const h = entries.get(id);
    const entry: DoneEntry = { source: APP_CLOSED_QUESTS.has(id) ? "journal" : "self" };
    if (h) {
      if (h.at) entry.at = h.at;
      entry.xp = h.xp || 0;
      entry.coins = h.coins || 0;
    }
    const carried = qd?.carried?.[id];
    if (carried) entry.mode = carried;
    done[id] = entry;
  }

  const passed = Object.keys(s.passedQuestsToday || {}).filter((id) => s.passedQuestsToday![id] && !done[id] && !replacedFrom.has(id));
  const stat = s.dailyStats?.[day];
  const selfXp = (s.history || []).reduce((n, h) => (h.completedAt === day && !APP_CLOSED_QUESTS.has(h.questId) ? n + (h.xp || 0) : n), 0);

  const snap: DaySnapshot = {
    v: SNAPSHOT_VERSION,
    day,
    core,
    bonus,
    offered,
    done,
    passed,
    replaced,
    modeChanges: tracked ? [...(qd!.modeChanges || [])] : [],
    restDay: !!s.isRestDay || !!stat?.isRestDay,
    shieldUsed,
    totals: { xp: stat?.xpGained || 0, coins: stat?.coinsGained || 0, selfXp, quests: stat?.totalQuestsCompleted || 0 },
    recordedAt: at.toISOString(),
  };
  if (qd) {
    snap.mode = s.isRestDay ? "rest" : qd.mode;
    if (qd.modeBeforeRest) snap.modeBeforeRest = qd.modeBeforeRest;
    snap.catalogVersion = qd.catalogVersion;
  }
  if (incomplete.length) snap.incomplete = incomplete;
  return snap;
}

/** The oldest closed day kept on a given day (inclusive): the last DAY_SNAPSHOT_RETENTION_DAYS closed days (today is open). */
export const retentionStart = (today: string) => addDaysToKey(today, -DAY_SNAPSHOT_RETENTION_DAYS);

/**
 * Adds a day snapshot once (an existing one for that day is kept as it is) and drops snapshots older than the retention
 * window. Newest first. Only `questDays` changes.
 */
export function addDaySnapshot(list: DaySnapshot[] | undefined, snap: DaySnapshot, today: string): DaySnapshot[] {
  const current = list || [];
  const next = current.some((d) => d.day === snap.day) ? current : [snap, ...current];
  return pruneDaySnapshots(next, today);
}

export function pruneDaySnapshots(list: DaySnapshot[], today: string): DaySnapshot[] {
  const from = retentionStart(today);
  return list.filter((d) => d.day >= from).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/* ------------------------------------------------------------------ the week snapshot */

export interface ClosingWeek {
  week: string;
  questWeek?: { week: string; boss: BossId };
  dailyStats: ClosingDay["dailyStats"];
  questDays: DaySnapshot[];
}

/** The snapshot of the week that is closing (totals from the day statistics; the challenge as it was chosen). */
export function buildWeekSnapshot(w: ClosingWeek, at: Date): WeekSnapshot {
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(w.week, i));
  const totals = { xp: 0, coins: 0, quests: 0 };
  for (const d of days) {
    const st = w.dailyStats?.[d];
    totals.xp += st?.xpGained || 0;
    totals.coins += st?.coinsGained || 0;
    totals.quests += st?.totalQuestsCompleted || 0;
  }
  const snap: WeekSnapshot = { v: SNAPSHOT_VERSION, week: w.week, daysRecorded: days.filter((d) => w.questDays.some((s) => s.day === d)), totals, recordedAt: at.toISOString() };
  if (w.questWeek && w.questWeek.week === w.week) snap.boss = w.questWeek.boss;
  return snap;
}

/** Weeks are kept while any of their days is inside the day retention window. */
export function addWeekSnapshot(list: WeekSnapshot[] | undefined, snap: WeekSnapshot, today: string): WeekSnapshot[] {
  const current = list || [];
  const next = current.some((w) => w.week === snap.week) ? current : [snap, ...current];
  return pruneWeekSnapshots(next, today);
}

export function pruneWeekSnapshots(list: WeekSnapshot[], today: string): WeekSnapshot[] {
  const from = mondayOfKey(retentionStart(today));
  return list.filter((w) => w.week >= from).sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
}

/**
 * The week challenge's result, written once for a closed week (the journal is read in the next week, so it is
 * «by the journal at that time»). No reward of any kind. A week without a snapshot, without a challenge, the current
 * week or a week that already has a result are left as they are.
 */
export function withBossResult(list: WeekSnapshot[] | undefined, week: string, currentWeek: string, result: NonNullable<WeekSnapshot["bossResult"]>): WeekSnapshot[] | null {
  const current = list || [];
  const i = current.findIndex((w) => w.week === week);
  if (i < 0 || week >= currentWeek || !current[i].boss || current[i].bossResult) return null;
  const next = current.slice();
  next[i] = { ...current[i], bossResult: result };
  return next;
}

/* ------------------------------------------------------------------ reading saved data (old or damaged saves) */

const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMode = (v: unknown): v is DayMode => typeof v === "string" && (DAY_MODES as string[]).includes(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Saved day snapshots: anything that is not a valid snapshot is dropped (never guessed); one per day, newest first. */
export function readDaySnapshots(raw: unknown): DaySnapshot[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DaySnapshot[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const d = r as Partial<DaySnapshot>;
    if (d.v !== 1 || !isKey(d.day) || seen.has(d.day) || !d.done || typeof d.done !== "object" || !d.totals) continue;
    seen.add(d.day);
    out.push({
      ...(d as DaySnapshot),
      mode: isMode(d.mode) ? d.mode : undefined,
      core: strings(d.core),
      bonus: strings(d.bonus),
      offered: strings(d.offered),
      passed: strings(d.passed),
      replaced: Array.isArray(d.replaced) ? d.replaced.filter((x) => x && typeof x.from === "string" && typeof x.to === "string") : [],
      modeChanges: Array.isArray(d.modeChanges) ? d.modeChanges.filter((x) => x && isMode(x.to) && typeof x.at === "string") : [],
      restDay: !!d.restDay,
      shieldUsed: !!d.shieldUsed,
    });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

export function readWeekSnapshots(raw: unknown): WeekSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WeekSnapshot[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const w = r as Partial<WeekSnapshot>;
    if (w.v !== 1 || !isKey(w.week) || seen.has(w.week) || !w.totals) continue;
    seen.add(w.week);
    out.push({ ...(w as WeekSnapshot), daysRecorded: strings(w.daysRecorded) });
  }
  return out.sort((a, b) => (a.week < b.week ? 1 : -1));
}
