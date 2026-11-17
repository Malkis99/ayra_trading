/**
 * QH-8.1 Personal Quests / «My path» — the model only (docs/quest-hub-qh8-spec.md).
 *
 * QH-8.2 wires creating, keeping and abandoning runs (GameState.personalRuns); QH-8.3 the daily journey: self-report
 * marks, the quest diary and the chapters (data-confirmed days are read from the Journal, lib/personal-quest-days.ts).
 * QH-8.4: completing a run on day 31+ with the final report — the rank, the category achievement, the saved result.
 * QH-8.5: that completion pays its XP once, by the owner's approved variant C (В-19) — never Coins, never for daily
 * marks, chapters or notes. Runs completed before QH-8.5 keep their unpaid entry and are never paid after the fact.
 *
 * A personal quest is a 30-day run of one measurable daily action. Daily marks give nothing; after the period ends and
 * the final report is written, the run gets a completion rank by its confirmed days, and — only then, once per run — a
 * reward (XP only, never Coins). Each category has its own achievement with Bronze, Silver and Gold; a better run raises it, a
 * repeated or worse run never lowers it or adds a duplicate.
 */

import { addDaysToKey } from "./day-key";

/* ------------------------------------------------------------------ categories (an extensible registry) */

export type PQCategoryId = "discipline" | "physical" | "learning" | "psychology" | "trading" | "habits";

/**
 * How a day of the run is confirmed:
 * - app: a record saved in AYRA that day passes the category's check (the Quest Hub mission checks);
 * - self: the person's own mark — always shown as a self-report, never as a verified fact.
 */
export type PQVerification = "app" | "self";

export interface PQCategory {
  id: PQCategoryId;
  /** lucide-react icon name (resolved by the UI). */
  icon: string;
  /** The ways a day can be confirmed in this category (the first is the default). */
  verification: readonly PQVerification[];
  /** Which saved records confirm a day (app): ids of the existing Quest Hub mission checks. Never trades or risk. */
  appChecks: readonly string[];
  /**
   * 16–17 mode (В-23): the category stays open, but templates and hints use neutral wording about skills, habits and
   * well-being only — no goals about weight, weight loss, calories, body measurements, diagnoses or psychological
   * assessments, and no automatic medical advice.
   */
  minorSafeWording: boolean;
}

/** Dictionary keys: `personalQuests.categories.<id>.{name,description}` and `personalQuests.achievements.<id>.{name,description}`. */
export const PQ_CATEGORIES: readonly PQCategory[] = [
  { id: "discipline", icon: "ShieldCheck", verification: ["app", "self"], appChecks: ["q_bias", "q_riskcheck", "m_plan_tomorrow"], minorSafeWording: false },
  { id: "physical", icon: "Dumbbell", verification: ["self"], appChecks: [], minorSafeWording: true },
  { id: "learning", icon: "GraduationCap", verification: ["app", "self"], appChecks: ["m_lesson", "m_backtest", "m_observation"], minorSafeWording: false },
  { id: "psychology", icon: "Brain", verification: ["app", "self"], appChecks: ["m_day_state", "m_mistake", "q_reflect"], minorSafeWording: true },
  { id: "trading", icon: "LineChart", verification: ["app"], appChecks: ["q_bias", "q_reflect", "m_trade_review"], minorSafeWording: false },
  { id: "habits", icon: "Repeat", verification: ["self"], appChecks: [], minorSafeWording: false },
];

export const categoryOf = (id: string): PQCategory | undefined => PQ_CATEGORIES.find((c) => c.id === id);

/* ------------------------------------------------------------------ the run */

export const PQ_PERIOD_DAYS = 30;
/** At most this many personal quests are active at a time (В-20), and at most one of each category. */
export const PQ_MAX_ACTIVE = 3;
/** Shortest own text of the final report (as a session review note, MISSION_TEXT_MIN.sessionNote). */
export const PQ_REPORT_MIN = 80;

export type PQRank = "bronze" | "silver" | "gold";
export const PQ_RANKS: readonly PQRank[] = ["bronze", "silver", "gold"];
/** Confirmed days needed for each rank (fewer than Bronze: completed without a reward, the history is kept). */
export const PQ_RANK_DAYS: Record<PQRank, number> = { bronze: 21, silver: 25, gold: 29 };

export type PQRates = Record<PQVerification, Record<PQRank, number>>;

/**
 * APPROVED (variant C, В-19): a run confirmed by AYRA data gets the full rate, a self-reported run half. XP only, no
 * Coins; fewer than 21 days — nothing. Not used by the game until QH-8.5.
 */
export const PQ_RANK_XP: PQRates = {
  app: { bronze: 100, silver: 180, gold: 250 },
  self: { bronze: 50, silver: 90, gold: 125 },
};

export function rankFor(confirmedDays: number): PQRank | null {
  if (confirmedDays >= PQ_RANK_DAYS.gold) return "gold";
  if (confirmedDays >= PQ_RANK_DAYS.silver) return "silver";
  if (confirmedDays >= PQ_RANK_DAYS.bronze) return "bronze";
  return null;
}

export interface PQMark {
  /** The game day the mark is for. */
  day: string;
  /** When it was saved (ISO). */
  at: string;
  /** The game day it was saved on (a mark counts only when saved on its own day: no backfilling). */
  savedOn: string;
  source: PQVerification;
  /**
   * app: the key of the saved record it points to. NOT a proof by itself: a day counts only when the record check
   * (PQRecordCheck) finds that record saved and passing the category's Quest Hub check on that day.
   */
  sourceKey?: string;
  /** app: the Quest Hub check the record passed (a mission id). */
  check?: string;
  note?: string;
}

/**
 * The quest diary (QH-8.3): a short reflection on one day of the run — separate from the trading Journal. It never
 * confirms a day: a note about yesterday is kept and shown as such (В-21), and it gives nothing.
 */
export interface PQNote {
  /** The game day it is about. */
  day: string;
  /** The game day it was last saved on (later than `day`: a note about an earlier day). */
  savedOn: string;
  /** First and last save (ISO). */
  createdAt: string;
  at: string;
  done: string;
  worked: string;
  hard: string;
  learned: string;
}
export const PQ_NOTE_FIELDS = ["done", "worked", "hard", "learned"] as const;
export type PQNoteField = (typeof PQ_NOTE_FIELDS)[number];
/** The longest text of one diary field (a UX limit). */
export const PQ_NOTE_MAX = 500;

export type PQStatus = "active" | "awaitingReport" | "completed" | "abandoned";

export interface PQRun {
  /** This run (a repeat of a quest is a new run with a new id). */
  id: string;
  /** When it was created (ISO). */
  createdAt?: string;
  /** When it was abandoned (ISO). */
  abandonedAt?: string;
  /** The abandoned run this one restarts (В-22); the old run stays in the history. */
  restartOf?: string;
  /** The quest it belongs to (repeats share it). */
  questId: string;
  category: PQCategoryId;
  title: string;
  goal: string;
  dailyAction: string;
  startState: string;
  expectedResult: string;
  verification: PQVerification;
  /** First game day of the period; the period is 30 game days. */
  startDay: string;
  marks: PQMark[];
  /** The quest diary, one entry per day (QH-8.3); kept when the run is abandoned or restarted. */
  notes?: PQNote[];
  status: PQStatus;
  report?: { at: string; text: string };
  /**
   * The checked result, saved once at completion (QH-8.4): the rank, the confirmed days and the very marks they were
   * counted from (with their Journal sources for data-confirmed runs). A completed run is shown and kept from this —
   * later changes in the Journal never count it again.
   */
  result?: PQResult;
}

export interface PQResult {
  rank: PQRank | null;
  days: number;
  /** The game day and the time it was completed. */
  day: string;
  at: string;
  verification: PQVerification;
  /** The marks that counted, oldest first. */
  marks: PQMark[];
}

/** The longest final report (a UX limit). */
export const PQ_REPORT_MAX = 2000;
/** The XP a result pays (variant C): by its rank and its way of confirmation; no rank — nothing. */
export const rankXp = (rank: PQRank | null, verification: PQVerification, rates: PQRates = PQ_RANK_XP): number => (rank ? rates[verification][rank] : 0);

export const endDayOf = (run: Pick<PQRun, "startDay">) => addDaysToKey(run.startDay, PQ_PERIOD_DAYS - 1);

/**
 * Confirms an app mark against the real data: the record behind `mark.sourceKey` exists in the saved Journal, was saved
 * on `mark.day` and passes one of the category's Quest Hub checks (PQCategory.appChecks). QH-8.3 must implement it with
 * the Journal and the existing mission checks (candidateSources); a key in the game state alone never confirms a day.
 */
export type PQRecordCheck = (mark: PQMark, run: Pick<PQRun, "id" | "category">) => boolean;

/** With no record check nothing app-confirmed counts (fail closed). */
export const NO_RECORDS: PQRecordCheck = () => false;

/**
 * Days that count: inside the period, saved on their own game day, one per day. An app mark counts only when the record
 * check confirms its record, and one record confirms one day; a self mark counts as a self-report (the history says
 * so). Late marks (В-21: a note about yesterday may be kept, it just never counts), early, outside or repeated marks
 * stay in the diary but do not count.
 */
export function confirmedDays(run: Pick<PQRun, "id" | "category" | "startDay" | "marks" | "verification">, check: PQRecordCheck): number {
  const end = endDayOf(run);
  const days = new Set<string>();
  const used = new Set<string>();
  for (const m of run.marks) {
    if (m.day < run.startDay || m.day > end || m.savedOn !== m.day) continue;
    if (m.source !== run.verification || days.has(m.day)) continue;
    if (m.source === "app") {
      if (!m.sourceKey || used.has(m.sourceKey) || !check(m, run)) continue;
      used.add(m.sourceKey);
    }
    days.add(m.day);
  }
  return days.size;
}

/** The run's state on `today` (the period is over the day after its last day). */
export function phaseOf(run: PQRun, today: string): PQStatus {
  if (run.status === "abandoned" || run.status === "completed") return run.status;
  return today > endDayOf(run) ? "awaitingReport" : "active";
}

/* ------------------------------------------------------------------ starting a run */

export type StartFailure = "maxActive" | "sameQuestActive" | "categoryActive" | "unknownCategory" | "verificationNotAllowed" | "missingFields" | "tooLong";

/** The text fields of a run and their longest length (a UX limit, not a business number). */
export const PQ_FIELD_MAX = { title: 80, goal: 200, dailyAction: 140, startState: 300, expectedResult: 300 } as const;
export type PQField = keyof typeof PQ_FIELD_MAX;
export const PQ_FIELDS = Object.keys(PQ_FIELD_MAX) as PQField[];

/** Trims and joins repeated spaces (line breaks kept out: every field is one paragraph). */
export const cleanField = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export type PQStartInput = Pick<PQRun, "questId" | "category" | "verification" | PQField>;

/**
 * A new run may start when fewer than 3 runs are active, the same quest has no active run (a repeat starts only after
 * the previous run ended), no other run of the category is active (В-20), the category exists and allows the chosen
 * verification, and every field is filled. An abandoned run frees its slot at once (В-22): the restart is a new run
 * with its own id, its own 30-day period and no progress; the abandoned run stays in the history.
 */
export function canStart(runs: PQRun[], next: PQStartInput, today: string): StartFailure | null {
  const cat = categoryOf(next.category);
  if (!cat) return "unknownCategory";
  if (!cat.verification.includes(next.verification)) return "verificationNotAllowed";
  if (!PQ_FIELDS.every((f) => cleanField(next[f]).length > 0)) return "missingFields";
  if (PQ_FIELDS.some((f) => cleanField(next[f]).length > PQ_FIELD_MAX[f])) return "tooLong";
  const active = runs.filter((r) => phaseOf(r, today) === "active" || phaseOf(r, today) === "awaitingReport");
  if (active.length >= PQ_MAX_ACTIVE) return "maxActive";
  if (active.some((r) => r.questId === next.questId)) return "sameQuestActive";
  if (active.some((r) => r.category === next.category)) return "categoryActive";
  return null;
}

/** Active runs on `today` (a run awaiting its report holds its slot), oldest first. */
export const activeRuns = (runs: readonly PQRun[], today: string): PQRun[] =>
  runs.filter((r) => { const p = phaseOf(r, today); return p === "active" || p === "awaitingReport"; });

/** The day of the period `today` is (1…30; past the end stays 30). */
export function dayNumber(run: Pick<PQRun, "startDay">, today: string): number {
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${run.startDay}T00:00:00Z`)) / 86400000) + 1;
  return Math.max(1, Math.min(PQ_PERIOD_DAYS, d));
}

/** Days left after `today`, today included (0 when the period is over). */
export function daysLeft(run: Pick<PQRun, "startDay">, today: string): number {
  const end = endDayOf(run);
  if (today > end) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1;
}

/* ------------------------------------------------------------------ chapters (QH-8.3) */

export type PQChapterId = "awareness" | "resistance" | "strengthening" | "consolidation";
/** Four chapters of the 30 days by the calendar (a missed day never moves them). The story of the run — no rewards. */
export const PQ_CHAPTERS: ReadonlyArray<{ id: PQChapterId; from: number; to: number }> = [
  { id: "awareness", from: 1, to: 7 },
  { id: "resistance", from: 8, to: 14 },
  { id: "strengthening", from: 15, to: 21 },
  { id: "consolidation", from: 22, to: 30 },
];
export const chapterOf = (dayN: number) => PQ_CHAPTERS.find((c) => dayN >= c.from && dayN <= c.to) ?? PQ_CHAPTERS[PQ_CHAPTERS.length - 1];

/* ------------------------------------------------------------------ the daily journey (QH-8.3) */

export type MarkFailure = "notFound" | "notActive" | "notSelf";

/**
 * A self-report for today: only an active run confirmed by self-report, only for `today` (the account's game day), once
 * a day — the same mark again (a double click, a second tab) changes nothing. Gives nothing.
 */
export function markSelfDay(runs: readonly PQRun[], runId: string, today: string, at: string): { runs: PQRun[]; duplicate: boolean } | { failure: MarkFailure } {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { failure: "notFound" };
  if (phaseOf(run, today) !== "active" || today < run.startDay) return { failure: "notActive" };
  if (run.verification !== "self") return { failure: "notSelf" };
  if (run.marks.some((m) => m.day === today && m.savedOn === today && m.source === "self")) return { runs: [...runs], duplicate: true };
  const mark: PQMark = { day: today, at, savedOn: today, source: "self" };
  return { runs: runs.map((r) => (r.id === runId ? { ...r, marks: [...r.marks, mark] } : r)), duplicate: false };
}

export type NoteFailure = "notFound" | "notOpen" | "dayNotAllowed" | "empty" | "tooLong";

/**
 * Saves the diary entry of a day: today, or yesterday (kept as a note about an earlier day — it never confirms it).
 * Only a run still open (active or awaiting its report), only days of its period. Saving again replaces the entry.
 */
export function saveDayNote(
  runs: readonly PQRun[],
  runId: string,
  input: { day: string } & Partial<Record<PQNoteField, string>>,
  today: string,
  at: string
): { runs: PQRun[] } | { failure: NoteFailure } {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { failure: "notFound" };
  const phase = phaseOf(run, today);
  if (phase !== "active" && phase !== "awaitingReport") return { failure: "notOpen" };
  const yesterday = addDaysToKey(today, -1);
  if ((input.day !== today && input.day !== yesterday) || input.day < run.startDay || input.day > endDayOf(run)) return { failure: "dayNotAllowed" };
  const texts = Object.fromEntries(PQ_NOTE_FIELDS.map((f) => [f, typeof input[f] === "string" ? input[f]!.trim() : ""])) as Record<PQNoteField, string>;
  if (PQ_NOTE_FIELDS.every((f) => !texts[f])) return { failure: "empty" };
  if (PQ_NOTE_FIELDS.some((f) => texts[f].length > PQ_NOTE_MAX)) return { failure: "tooLong" };
  const had = (run.notes ?? []).find((n) => n.day === input.day);
  const note: PQNote = { day: input.day, savedOn: today, createdAt: had?.createdAt ?? at, at, ...texts };
  const notes = [...(run.notes ?? []).filter((n) => n.day !== input.day), note].sort((a, b) => a.day.localeCompare(b.day));
  return { runs: runs.map((r) => (r.id === runId ? { ...r, notes } : r)) };
}

/* ------------------------------------------------------------------ keeping runs (QH-8.2) */

/**
 * Starts a run on `today` (the account's game day: never chosen, never in the past). Idempotent by `input.id`: the same
 * request again (a double click, a reload, a second tab sending the same draft) returns the saved run, never a second
 * one. Gives nothing.
 */
export function createRun(
  runs: readonly PQRun[],
  input: PQStartInput & { id: string; restartOf?: string },
  today: string,
  at: string
): { runs: PQRun[]; run: PQRun; duplicate: boolean } | { failure: StartFailure | "badId" } {
  const same = runs.find((r) => r.id === input.id);
  if (same) return { runs: [...runs], run: same, duplicate: true };
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(input.id) || !/^[A-Za-z0-9_-]{6,80}$/.test(input.questId)) return { failure: "badId" };
  const clean = { ...input, ...Object.fromEntries(PQ_FIELDS.map((f) => [f, cleanField(input[f])])) } as typeof input;
  const failure = canStart([...runs], clean, today);
  if (failure) return { failure };
  const run: PQRun = {
    id: clean.id,
    questId: clean.questId,
    category: clean.category,
    verification: clean.verification,
    title: clean.title,
    goal: clean.goal,
    dailyAction: clean.dailyAction,
    startState: clean.startState,
    expectedResult: clean.expectedResult,
    startDay: today,
    createdAt: at,
    marks: [],
    status: "active",
    ...(clean.restartOf ? { restartOf: clean.restartOf } : {}),
  };
  return { runs: [run, ...runs], run, duplicate: false };
}

export type AbandonFailure = "notFound" | "notActive";

/** Abandons an active run (also one awaiting its report): kept in the history as abandoned, no rank, no reward. */
export function abandonRun(runs: readonly PQRun[], runId: string, today: string, at: string): { runs: PQRun[] } | { failure: AbandonFailure } {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { failure: "notFound" };
  const phase = phaseOf(run, today);
  if (phase !== "active" && phase !== "awaitingReport") return { failure: "notActive" };
  return { runs: runs.map((r) => (r.id === runId ? { ...r, status: "abandoned" as const, abandonedAt: at } : r)) };
}

export type RestartFailure = StartFailure | "badId" | "notFound" | "notAbandoned";

/**
 * Starts an abandoned quest again at once (В-22): a new run with the new id, the same quest and texts, its own 30 days
 * from `today`, no marks. The abandoned run stays as it was. Idempotent by `newId`.
 */
export function restartRun(runs: readonly PQRun[], runId: string, newId: string, today: string, at: string): ReturnType<typeof createRun> | { failure: RestartFailure } {
  const same = runs.find((r) => r.id === newId);
  if (same) return { runs: [...runs], run: same, duplicate: true };
  const old = runs.find((r) => r.id === runId);
  if (!old) return { failure: "notFound" };
  if (old.status !== "abandoned") return { failure: "notAbandoned" };
  const { questId, category, verification, title, goal, dailyAction, startState, expectedResult } = old;
  return createRun(runs, { id: newId, questId, category, verification, title, goal, dailyAction, startState, expectedResult, restartOf: old.id }, today, at);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readResult(raw: unknown): PQResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<PQResult>;
  if (r.rank !== null && !PQ_RANKS.includes(r.rank as PQRank)) return undefined;
  if (typeof r.days !== "number" || typeof r.day !== "string" || !DAY_RE.test(r.day) || (r.verification !== "app" && r.verification !== "self")) return undefined;
  const marks = Array.isArray(r.marks) ? r.marks.filter((m): m is PQMark => !!m && typeof m === "object" && typeof m.day === "string" && (m.source === "app" || m.source === "self")) : [];
  return { rank: (r.rank ?? null) as PQRank | null, days: r.days, day: r.day, at: typeof r.at === "string" ? r.at : "", verification: r.verification, marks };
}

/** Category achievements from a saved game state: one per known category, a known rank; anything else is dropped. */
export function readAchievements(raw: unknown): PQAchievements {
  if (!raw || typeof raw !== "object") return {};
  const out: PQAchievements = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!categoryOf(k) || !v || typeof v !== "object") continue;
    const a = v as { rank?: unknown; runId?: unknown; day?: unknown; verification?: unknown };
    if (!PQ_RANKS.includes(a.rank as PQRank) || typeof a.runId !== "string" || typeof a.day !== "string") continue;
    out[k as PQCategoryId] = { rank: a.rank as PQRank, runId: a.runId, day: a.day, verification: a.verification === "self" ? "self" : "app" };
  }
  return out;
}

/**
 * The completion ledger from a saved game state: one entry per run id (the first kept). A paid entry (QH-8.5) keeps
 * the XP its rank and way of confirmation pay — the stored number itself is never trusted; an entry without the mark
 * (QH-8.4, before rewards) stays unpaid at 0 XP.
 */
export function readLedger(raw: unknown): PQLedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PQLedgerEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const x = e as Partial<PQLedgerEntry>;
    if (typeof x.runId !== "string" || out.some((o) => o.runId === x.runId) || !categoryOf(String(x.category))) continue;
    const rank = PQ_RANKS.includes(x.rank as PQRank) ? (x.rank as PQRank) : null;
    const verification: PQVerification = x.verification === "self" ? "self" : "app";
    const paid = x.paid === true;
    out.push({ runId: x.runId, questId: String(x.questId ?? ""), category: x.category as PQCategoryId, rank, days: Number(x.days) || 0, xp: paid ? rankXp(rank, verification) : 0, day: String(x.day ?? ""), at: String(x.at ?? ""), verification, ...(paid ? { paid: true } : {}) });
  }
  return out;
}
const STATUSES: readonly PQStatus[] = ["active", "awaitingReport", "completed", "abandoned"];

/**
 * Runs from a saved game state (an old save has none). A damaged entry is dropped, never guessed; a repeated id keeps
 * the first copy. Marks are kept as saved (QH-8.3 reads them).
 */
export function readPersonalRuns(raw: unknown): PQRun[] {
  if (!Array.isArray(raw)) return [];
  const out: PQRun[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const x = r as Partial<PQRun>;
    if (typeof x.id !== "string" || !x.id || typeof x.questId !== "string" || !x.questId) continue;
    const cat = categoryOf(String(x.category));
    if (!cat || !cat.verification.includes(x.verification as PQVerification)) continue;
    if (typeof x.startDay !== "string" || !DAY_RE.test(x.startDay) || !STATUSES.includes(x.status as PQStatus)) continue;
    if (!PQ_FIELDS.every((f) => typeof x[f] === "string")) continue;
    if (out.some((o) => o.id === x.id)) continue;
    const marks = Array.isArray(x.marks)
      ? x.marks.filter((m): m is PQMark => !!m && typeof m === "object" && typeof m.day === "string" && typeof m.savedOn === "string" && (m.source === "app" || m.source === "self"))
      : [];
    const notes = Array.isArray(x.notes)
      ? x.notes.filter((n): n is PQNote => !!n && typeof n === "object" && typeof n.day === "string" && DAY_RE.test(n.day) && typeof n.savedOn === "string" && PQ_NOTE_FIELDS.every((f) => typeof n[f] === "string"))
      : undefined;
    const result = readResult(x.result);
    out.push({ ...(x as PQRun), marks, ...(notes ? { notes } : {}), ...(result ? { result } : {}) } as PQRun);
  }
  return out;
}

/* ------------------------------------------------------------------ settling a run */

/** One paid run in the reward ledger (append-only; the key is the run id). */
export interface PQLedgerEntry {
  runId: string;
  questId: string;
  category: PQCategoryId;
  rank: PQRank | null;
  days: number;
  xp: number;
  /** The game day the run was settled. */
  day: string;
  at: string;
  verification: PQVerification;
  /**
   * QH-8.5: true when this completion paid its XP (`xp` is what was paid). Entries of QH-8.4 have none: they were
   * completed without a reward and stay unpaid — no XP is ever paid for them afterwards.
   */
  paid?: boolean;
}

export type SettleFailure = "periodNotOver" | "reportMissing" | "reportShort" | "abandoned" | "alreadySettled";

/**
 * The final step: only after the period is over and with a final report of 80+ own characters, once per run.
 * The rank comes from the confirmed days (the same rank for app and self runs; the entry says which); the reward from
 * the rates by the run's verification (PQ_RANK_XP, variant C). Fewer than 21 days: settled with no rank and no reward,
 * kept in the history. Nothing in the game calls this before QH-8.5.
 */
export function settleRun(
  run: PQRun,
  ledger: readonly PQLedgerEntry[],
  report: string,
  today: string,
  at: string,
  check: PQRecordCheck,
  rates: PQRates = PQ_RANK_XP
): { entry: PQLedgerEntry } | { failure: SettleFailure } {
  if (run.status === "abandoned") return { failure: "abandoned" };
  if (ledger.some((e) => e.runId === run.id) || run.status === "completed") return { failure: "alreadySettled" };
  if (today <= endDayOf(run)) return { failure: "periodNotOver" };
  const text = (report || "").trim();
  if (!text) return { failure: "reportMissing" };
  if (text.length < PQ_REPORT_MIN) return { failure: "reportShort" };
  const days = confirmedDays(run, check);
  const rank = rankFor(days);
  return { entry: { runId: run.id, questId: run.questId, category: run.category, rank, days, xp: rank ? rates[run.verification][rank] : 0, day: today, at, verification: run.verification } };
}

export type CompleteFailure = SettleFailure | "notFound" | "reportLong";

/**
 * Completes a run (QH-8.4): from the day after its 30th day, with a final report of 80+ characters of the person's own
 * text, once. `marks` are the confirmed marks the caller found for it — for a data-confirmed run the shared Journal
 * distribution (В-24), checked again here by `check`; for a self-reported run its own self marks. The rank comes from
 * them; the result and the report are saved in the run (status «completed»), and a ledger entry at 0 XP is returned.
 * The same completion again returns the saved result (`duplicate`) — never a second one.
 */
export function completeRun(
  runs: readonly PQRun[],
  ledger: readonly PQLedgerEntry[],
  runId: string,
  report: string,
  marks: PQMark[],
  check: PQRecordCheck,
  today: string,
  at: string,
  rates: PQRates = PQ_RANK_XP
): { runs: PQRun[]; entry: PQLedgerEntry; result: PQResult; duplicate: boolean } | { failure: CompleteFailure } {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { failure: "notFound" };
  if (run.status === "completed" && run.result) {
    const entry = ledger.find((e) => e.runId === runId);
    if (entry) return { runs: [...runs], entry, result: run.result, duplicate: true };
  }
  const text = cleanField(report);
  if (text.length > PQ_REPORT_MAX) return { failure: "reportLong" };
  const own = run.verification === "self" ? marks.filter((m) => m.source === "self") : marks;
  const res = settleRun({ ...run, marks: own }, ledger, text, today, at, check, rates);
  if ("failure" in res) return res;
  const entry: PQLedgerEntry = { ...res.entry, paid: true };
  // keep exactly the marks that counted (one a day, inside the period, passing the check)
  const counted: PQMark[] = [];
  const end = endDayOf(run);
  for (const m of [...own].sort((a, b) => a.day.localeCompare(b.day))) {
    if (m.day < run.startDay || m.day > end || m.savedOn !== m.day || m.source !== run.verification) continue;
    if (counted.some((c) => c.day === m.day)) continue;
    if (m.source === "app" && !check(m, run)) continue;
    counted.push(m);
  }
  const result: PQResult = { rank: res.entry.rank, days: res.entry.days, day: today, at, verification: run.verification, marks: counted };
  const next = runs.map((r) => (r.id === runId ? { ...r, status: "completed" as const, report: { at, text }, result } : r));
  return { runs: next, entry, result, duplicate: false };
}

/* ------------------------------------------------------------------ category achievements */

/**
 * The achievement tier of each category: the best rank ever settled (never lowered, never duplicated). The rank is the
 * same for app and self runs; `verification` keeps how the earning run was confirmed, to be shown next to it.
 */
export type PQAchievements = Partial<Record<PQCategoryId, { rank: PQRank; runId: string; day: string; verification: PQVerification }>>;

const RANK_ORDER: Record<PQRank, number> = { bronze: 1, silver: 2, gold: 3 };

/** A settled run raises its category's tier only when its rank is higher; otherwise nothing changes. */
export function withAchievement(current: PQAchievements, entry: PQLedgerEntry): { next: PQAchievements; upgraded: boolean } {
  if (!entry.rank) return { next: current, upgraded: false };
  const had = current[entry.category];
  if (had && RANK_ORDER[had.rank] >= RANK_ORDER[entry.rank]) return { next: current, upgraded: false };
  return { next: { ...current, [entry.category]: { rank: entry.rank, runId: entry.runId, day: entry.day, verification: entry.verification } }, upgraded: true };
}
