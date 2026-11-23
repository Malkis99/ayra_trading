/**
 * Q4.5-4 — reconciliation of device snapshots before an account moves to the server economy
 * (docs/q4-5-4-migration-provenance-audit.md). Pure and deterministic: the same snapshots give the same result in
 * any order. Nothing here credits anything: it lists what can be PROVEN (events with canonical keys, amounts checked
 * against the rule of their time), what cannot (a legacy candidate per snapshot, with reasons), and every conflict.
 *
 * Owner decision 2026-11-23 (V2 + V3 as evidence only): a legacy remainder is kept apart, reviewed by a person, never
 * credited automatically; cloud Journal records are supporting evidence, never a source of XP by themselves.
 *
 * No runtime imports: the owner's admin tool runs this file directly with Node (type stripping).
 */

/* ------------------------------------------------------------------ rules of the past (from git history) */

/** First-action amounts by rule version. #98 (2026-10-27 14:50 UTC) introduced them; #99 (15:34 UTC) changed the coins. */
export const FIRST_ACTION_RULES = {
  introducedAt: "2026-10-27T14:50:35Z",
  changedAt: "2026-10-27T15:34:24Z",
  /** PLACEHOLDER: deploy margin after a merge during which either rule may have been live (time on the device is the device's). */
  marginMs: 60 * 60 * 1000,
  before: {
    trade: { coins: 20, xp: 20 }, account: { coins: 10, xp: 10 }, strategy: { coins: 10, xp: 10 }, import: { coins: 10, xp: 10 },
    dayPlan: { coins: 10, xp: 10 }, weekPlan: { coins: 10, xp: 10 }, note: { coins: 10, xp: 10 }, noTrade: { coins: 10, xp: 10 },
    screenshot: { coins: 10, xp: 10 },
  } as Record<string, { coins: number; xp: number }>,
  after: {
    trade: { coins: 20, xp: 20 }, account: { coins: 10, xp: 10 }, strategy: { coins: 10, xp: 10 }, import: { coins: 20, xp: 10 },
    dayPlan: { coins: 5, xp: 10 }, weekPlan: { coins: 5, xp: 10 }, note: { coins: 5, xp: 10 }, noTrade: { coins: 5, xp: 10 },
    screenshot: { coins: 5, xp: 10 },
  } as Record<string, { coins: number; xp: number }>,
};
/** The daily Coins cap exists since #98 (game days from 2026-10-27 on). */
export const DAILY_COIN_CAP = { amount: 100, sinceDay: "2026-10-27" };
/** PLACEHOLDER bounds of a single quest entry (the catalogs never paid more): above them an entry is a conflict. */
export const QUEST_BOUNDS = { xp: 200, coins: 100 };
/** Daily reward amounts that ever existed. */
export const DAILY_REWARD_AMOUNTS: readonly number[] = [10, 15, 20, 25, 50];
/** Personal quest XP that ever existed (variant C, QH-8.5): app 100/180/250, self 50/90/125. */
export const PQ_XP: readonly number[] = [50, 90, 100, 125, 180, 250];

/* ------------------------------------------------------------------ types */

export interface Snapshot {
  snapshotId: string;
  installId: string;
  /** Server time of receipt (ISO) — never the device's. */
  receivedAt: string;
  /** The device's saved game state, as it was (raw parsed JSON; old versions lack fields). */
  state: Record<string, unknown>;
}

export type EventKind = "quest" | "first" | "pq" | "daily";

export interface ProvenEvent {
  key: string;
  kind: EventKind;
  /** The game day (YYYY-MM-DD) the event belongs to. */
  day: string;
  xp: number;
  coins: number;
  /** Which snapshots carry it (sorted). */
  sources: string[];
}

export type ConflictCode =
  | "amount_mismatch"
  | "amount_out_of_rule"
  | "daily_coin_cap"
  | "first_action_time_uncertain"
  | "first_action_before_rules"
  | "duplicate_in_snapshot"
  | "balance_below_records"
  | "level_xp_inconsistent"
  | "bad_record";

export interface Conflict {
  code: ConflictCode;
  /** The event key or snapshot it is about. */
  subject: string;
  detail: string;
  /** XP/Coins NOT confirmed because of it (they stay in the legacy candidate of the snapshot). */
  xp: number;
  coins: number;
}

export interface LegacyCandidate {
  snapshotId: string;
  installId: string;
  original: { level: number; xpInLevel: number; totalXp: number; coins: number; saveVersion: string };
  /** What this snapshot's own records prove (after the cross-device minimum). */
  confirmed: { xp: number; coins: number };
  /** total − confirmed, never below 0 — a CANDIDATE only (see reasons). */
  candidate: { xp: number; coins: number };
  /** Why part of the progress cannot be proven, with what is known about it. */
  reasons: Array<{ code: string; xp?: number; coins?: number; detail?: string }>;
}

export interface Reconciliation {
  /** Sorted snapshot ids and content hashes it was computed from. */
  inputs: string[];
  events: ProvenEvent[];
  conflicts: Conflict[];
  legacy: LegacyCandidate[];
  proposed: {
    confirmedXp: number;
    confirmedCoins: number;
    /** Level from the confirmed XP alone. */
    level: number;
    /** The highest original level of any snapshot. */
    originalLevel: number;
    /** originalLevel − level (> 0: the confirmed XP alone would lower the level — never applied silently). */
    levelGap: number;
    /** Highest original coins balance of any snapshot (for the review, not a value to credit). */
    originalCoins: number;
  };
  /** Achievements unlocked on any snapshot (kept as they were; the server economy has no achievement table yet). */
  achievements: string[];
}

/* ------------------------------------------------------------------ helpers */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
/** The XP needed to go from level `n` to `n + 1` (lib/game.ts xpForNextLevel). */
export const xpForNextLevel = (level: number) => 80 + 40 * level;
export function levelForTotalXp(total: number): number {
  let level = 1;
  let rest = total;
  while (rest >= xpForNextLevel(level)) {
    rest -= xpForNextLevel(level);
    level += 1;
  }
  return level;
}
export function totalXpOf(level: number, xpInLevel: number): number {
  let total = xpInLevel;
  for (let lv = 1; lv < level; lv++) total += xpForNextLevel(lv);
  return total;
}
/** The game day of a time in a zone (the account's time zone from its profile). */
export function dayIn(iso: string, timeZone: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    return DAY_RE.test(parts) ? parts : null;
  } catch {
    return null;
  }
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Which save format this is (the fields old versions did not have). */
export function saveVersionOf(state: Record<string, unknown>): string {
  const history = arr(state.history);
  const marks = [
    history.some((h) => typeof obj(h).at === "string") ? "history_at" : null,
    state.firstActions ? "first_actions" : null,
    Array.isArray(state.coinLog) ? "coin_log" : null,
    state.missionLedger ? "missions" : null,
    arr(state.personalLedger).some((e) => obj(e).paid === true) ? "pq_paid" : null,
  ].filter(Boolean);
  return marks.length ? marks.join("+") : "legacy";
}

/* ------------------------------------------------------------------ one snapshot: its records */

interface SnapshotEvents {
  events: Map<string, { kind: EventKind; day: string; xp: number; coins: number; time?: string }>;
  conflicts: Conflict[];
  original: LegacyCandidate["original"];
  reasons: LegacyCandidate["reasons"];
  achievements: string[];
}

function readSnapshot(s: Snapshot, timeZone: string): SnapshotEvents {
  const st = s.state;
  const events = new Map<string, { kind: EventKind; day: string; xp: number; coins: number; time?: string }>();
  const conflicts: Conflict[] = [];
  const reasons: LegacyCandidate["reasons"] = [];
  const level = isInt(st.level) && st.level >= 1 ? st.level : 1;
  const xpInLevel = isInt(st.xp) ? st.xp : 0;
  const coins = isInt(st.coins) ? st.coins : 0;
  if (xpInLevel >= xpForNextLevel(level)) {
    conflicts.push({ code: "level_xp_inconsistent", subject: s.snapshotId, detail: `xp ${xpInLevel} ≥ next level threshold ${xpForNextLevel(level)} at level ${level}`, xp: 0, coins: 0 });
  }
  const original = { level, xpInLevel, totalXp: totalXpOf(level, xpInLevel), coins, saveVersion: saveVersionOf(st) };

  // quests and missions: history (never pruned), amounts as actually paid
  const coinsByDay = new Map<string, number>();
  for (const raw of arr(st.history)) {
    const h = obj(raw);
    const day = h.completedAt;
    const id = h.questId;
    if (typeof day !== "string" || !DAY_RE.test(day) || typeof id !== "string" || !ID_RE.test(id) || !isInt(h.xp) || !isInt(h.coins)) {
      conflicts.push({ code: "bad_record", subject: s.snapshotId, detail: `history entry ${JSON.stringify(raw).slice(0, 120)}`, xp: isInt(h.xp) ? h.xp : 0, coins: isInt(h.coins) ? h.coins : 0 });
      continue;
    }
    const key = `quest:${day}:${id}`;
    if (events.has(key)) {
      conflicts.push({ code: "duplicate_in_snapshot", subject: key, detail: s.snapshotId, xp: h.xp, coins: h.coins });
      continue;
    }
    if (h.xp > QUEST_BOUNDS.xp || h.coins > QUEST_BOUNDS.coins) {
      conflicts.push({ code: "amount_out_of_rule", subject: key, detail: `${h.xp} XP / ${h.coins} Coins above any quest`, xp: h.xp, coins: h.coins });
      continue;
    }
    events.set(key, { kind: "quest", day, xp: h.xp, coins: h.coins });
    coinsByDay.set(day, (coinsByDay.get(day) ?? 0) + h.coins);
  }

  // first actions: the kind is the key; the amount follows the rule of the time the device recorded
  for (const [kind, at] of Object.entries(obj(st.firstActions))) {
    const key = `first:${kind}`;
    const t = typeof at === "string" ? Date.parse(at) : NaN;
    const before = FIRST_ACTION_RULES.before[kind];
    const after = FIRST_ACTION_RULES.after[kind];
    if (!before || !after || !Number.isFinite(t)) {
      conflicts.push({ code: "bad_record", subject: key, detail: `first action ${kind} at ${String(at)}`, xp: 0, coins: 0 });
      continue;
    }
    const intro = Date.parse(FIRST_ACTION_RULES.introducedAt);
    const change = Date.parse(FIRST_ACTION_RULES.changedAt);
    const day = dayIn(at as string, timeZone) ?? (at as string).slice(0, 10);
    if (t < intro - FIRST_ACTION_RULES.marginMs) {
      conflicts.push({ code: "first_action_before_rules", subject: key, detail: `recorded ${at}, before first actions existed`, xp: after.xp, coins: Math.max(before.coins, after.coins) });
      continue;
    }
    let rule = t < change ? before : after;
    if (Math.abs(t - change) <= FIRST_ACTION_RULES.marginMs) {
      // either rule may have been live: the smaller amount is confirmed, the difference is not
      rule = { xp: Math.min(before.xp, after.xp), coins: Math.min(before.coins, after.coins) };
      const dx = Math.max(before.xp, after.xp) - rule.xp;
      const dc = Math.max(before.coins, after.coins) - rule.coins;
      if (dx || dc) conflicts.push({ code: "first_action_time_uncertain", subject: key, detail: `recorded ${at}, within the margin of the rule change`, xp: dx, coins: dc });
    }
    events.set(key, { kind: "first", day, xp: rule.xp, coins: rule.coins, time: at as string });
  }

  // personal quests: only completions that paid (QH-8.5); the run id is the key
  for (const raw of arr(st.personalLedger)) {
    const e = obj(raw);
    if (e.paid !== true) continue;
    const runId = e.runId;
    if (typeof runId !== "string" || !ID_RE.test(runId) || !isInt(e.xp) || typeof e.day !== "string" || !DAY_RE.test(e.day)) {
      conflicts.push({ code: "bad_record", subject: s.snapshotId, detail: `personal ledger ${JSON.stringify(raw).slice(0, 120)}`, xp: isInt(e.xp) ? e.xp : 0, coins: 0 });
      continue;
    }
    const key = `pq:${runId}`;
    if (!PQ_XP.includes(e.xp)) {
      conflicts.push({ code: "amount_out_of_rule", subject: key, detail: `${e.xp} XP is no personal quest amount`, xp: e.xp, coins: 0 });
      continue;
    }
    if (events.has(key)) {
      conflicts.push({ code: "duplicate_in_snapshot", subject: key, detail: s.snapshotId, xp: e.xp, coins: 0 });
      continue;
    }
    events.set(key, { kind: "pq", day: e.day, xp: e.xp, coins: 0 });
  }

  // daily rewards: only inside the coin log (500 entries, since coinLogSince); the game day in the account's zone
  for (const raw of arr(st.coinLog)) {
    const e = obj(raw);
    if (e.source !== "dailyReward") continue;
    const day = typeof e.at === "string" ? dayIn(e.at, timeZone) : null;
    if (!day || !isInt(e.amount)) {
      conflicts.push({ code: "bad_record", subject: s.snapshotId, detail: `coin log ${JSON.stringify(raw).slice(0, 120)}`, xp: 0, coins: isInt(e.amount) ? e.amount : 0 });
      continue;
    }
    const key = `daily:${day}`;
    if (!DAILY_REWARD_AMOUNTS.includes(e.amount)) {
      conflicts.push({ code: "amount_out_of_rule", subject: key, detail: `${e.amount} Coins is no daily reward`, xp: 0, coins: e.amount });
      continue;
    }
    if (events.has(key)) {
      conflicts.push({ code: "duplicate_in_snapshot", subject: key, detail: s.snapshotId, xp: 0, coins: e.amount });
      continue;
    }
    events.set(key, { kind: "daily", day, xp: 0, coins: e.amount });
    coinsByDay.set(day, (coinsByDay.get(day) ?? 0) + e.amount);
  }

  // the daily Coins cap (since #98): quest and daily-reward Coins of a day above it are not confirmed
  for (const [day, sum] of [...coinsByDay].sort()) {
    if (day < DAILY_COIN_CAP.sinceDay || sum <= DAILY_COIN_CAP.amount) continue;
    let excess = sum - DAILY_COIN_CAP.amount;
    const ofDay = [...events.entries()].filter(([, ev]) => ev.day === day && ev.coins > 0 && (ev.kind === "quest" || ev.kind === "daily")).sort(([a], [b]) => (a < b ? 1 : -1));
    for (const [key, ev] of ofDay) {
      if (excess <= 0) break;
      const cut = Math.min(ev.coins, excess);
      ev.coins -= cut;
      excess -= cut;
      conflicts.push({ code: "daily_coin_cap", subject: key, detail: `${day}: ${sum} Coins recorded, cap ${DAILY_COIN_CAP.amount}`, xp: 0, coins: cut });
    }
  }

  // what is known about the rest (reasons of the legacy candidate; none of it is a proof)
  const historyXpByDay = new Map<string, number>();
  for (const [, ev] of events) if (ev.kind === "quest") historyXpByDay.set(ev.day, (historyXpByDay.get(ev.day) ?? 0) + ev.xp);
  let journalXp = 0;
  const journalDays: string[] = [];
  for (const [day, raw] of Object.entries(obj(st.dailyStats))) {
    const gained = obj(raw).xpGained;
    if (!DAY_RE.test(day) || !isInt(gained)) continue;
    const rest = gained - (historyXpByDay.get(day) ?? 0);
    if (rest > 0) {
      journalXp += rest;
      journalDays.push(day);
    }
  }
  if (journalXp > 0) reasons.push({ code: "journal_xp_by_day", xp: journalXp, detail: `XP recorded per day beyond quests (journal actions): ${journalDays.length} days — no per-event record` });
  const shots = arr(st.rewardedScreenshotHashes).length;
  if (shots > 0) reasons.push({ code: "screenshot_hashes", detail: `${shots} rewarded screenshot hashes — the hash proves no amount and no day` });
  const since = typeof st.coinLogSince === "string" ? st.coinLogSince : null;
  reasons.push({ code: "coins_before_log", detail: since ? `the coin log starts ${since}; earlier Coins are only in the balance` : "no coin log: every Coin is only in the balance" });
  if (original.saveVersion === "legacy") reasons.push({ code: "legacy_format", detail: "a save from before the reward records" });

  const achievements = Object.entries(obj(st.achievements)).filter(([, v]) => v === true).map(([k]) => k);
  return { events, conflicts, original, reasons, achievements };
}

/* ------------------------------------------------------------------ all snapshots of an account */

export function reconcile(snapshots: Snapshot[], timeZone: string, contentHashes: Record<string, string> = {}): Reconciliation {
  const sorted = [...snapshots].sort((a, b) => (a.snapshotId < b.snapshotId ? -1 : a.snapshotId > b.snapshotId ? 1 : 0));
  const read = sorted.map((s) => ({ s, r: readSnapshot(s, timeZone) }));
  const conflicts: Conflict[] = read.flatMap(({ r }) => r.conflicts);

  // the same key on several devices is ONE event; amounts must agree — the smaller is confirmed, the difference is not
  const byKey = new Map<string, Array<{ snap: string; kind: EventKind; day: string; xp: number; coins: number; time?: string }>>();
  for (const { s, r } of read) for (const [key, ev] of r.events) byKey.set(key, [...(byKey.get(key) ?? []), { snap: s.snapshotId, ...ev }]);
  const events: ProvenEvent[] = [];
  for (const key of [...byKey.keys()].sort()) {
    const all = byKey.get(key)!;
    const xp = Math.min(...all.map((e) => e.xp));
    const coins = Math.min(...all.map((e) => e.coins));
    const day = all.map((e) => e.day).sort()[0];
    if (all.some((e) => e.xp !== xp || e.coins !== coins)) {
      conflicts.push({ code: "amount_mismatch", subject: key, detail: all.map((e) => `${e.snap}: ${e.xp} XP / ${e.coins} Coins`).join("; "), xp: Math.max(...all.map((e) => e.xp)) - xp, coins: Math.max(...all.map((e) => e.coins)) - coins });
    }
    events.push({ key, kind: all[0].kind, day, xp, coins, sources: all.map((e) => e.snap).sort() });
  }

  // a legacy CANDIDATE per snapshot: what its total exceeds its own proven events by — never credited by itself
  const legacy: LegacyCandidate[] = read.map(({ s, r }) => {
    const own = events.filter((e) => e.sources.includes(s.snapshotId));
    const confirmed = { xp: own.reduce((a, e) => a + e.xp, 0), coins: own.reduce((a, e) => a + e.coins, 0) };
    const dx = r.original.totalXp - confirmed.xp;
    const dc = r.original.coins - confirmed.coins;
    if (dx < 0 || dc < 0) {
      conflicts.push({ code: "balance_below_records", subject: s.snapshotId, detail: `total ${r.original.totalXp} XP / ${r.original.coins} Coins below its records ${confirmed.xp} / ${confirmed.coins}`, xp: 0, coins: 0 });
    }
    return { snapshotId: s.snapshotId, installId: s.installId, original: r.original, confirmed, candidate: { xp: Math.max(0, dx), coins: Math.max(0, dc) }, reasons: r.reasons };
  });

  const confirmedXp = events.reduce((a, e) => a + e.xp, 0);
  const confirmedCoins = events.reduce((a, e) => a + e.coins, 0);
  const level = levelForTotalXp(confirmedXp);
  const originalLevel = Math.max(1, ...read.map(({ r }) => r.original.level));
  const achievements = [...new Set(read.flatMap(({ r }) => r.achievements))].sort();
  return {
    inputs: sorted.map((s) => `${s.snapshotId}:${contentHashes[s.snapshotId] ?? ""}`),
    events,
    conflicts: conflicts.sort((a, b) => (a.code + a.subject < b.code + b.subject ? -1 : a.code + a.subject > b.code + b.subject ? 1 : 0)),
    legacy,
    proposed: { confirmedXp, confirmedCoins, level, originalLevel, levelGap: Math.max(0, originalLevel - level), originalCoins: Math.max(0, ...read.map(({ r }) => r.original.coins)) },
    achievements,
  };
}

/**
 * V3 (owner decision: evidence only): cloud Journal records attached to the journal XP of a legacy candidate. A record
 * existing on a day does not prove a reward was given, nor when; edits and imports never become rewards. The result
 * is shown to the reviewer next to the candidate — it never changes a number.
 */
export function journalEvidence(candidate: LegacyCandidate, cloudRecordDays: Record<string, number>): { day: string; recordsThatDay: number }[] {
  const days = candidate.reasons.find((r) => r.code === "journal_xp_by_day") ? Object.keys(cloudRecordDays).sort() : [];
  return days.map((day) => ({ day, recordsThatDay: cloudRecordDays[day] }));
}
