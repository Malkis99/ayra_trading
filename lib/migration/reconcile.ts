/**
 * Q4.5-4 — reconciliation of device snapshots before an account moves to the server economy
 * (docs/q4-5-4-migration-provenance-audit.md). Pure and deterministic: the same snapshots give the same result in
 * any order. Nothing here credits anything: it lists what can be PROVEN (events with canonical keys, amounts checked
 * against the rules of the past), what cannot (a legacy candidate per snapshot, with reasons), and every conflict.
 *
 * Owner decision 2026-11-23 (V2 + V3 as evidence only): a legacy remainder is kept apart, reviewed by a person, never
 * credited automatically; cloud Journal records are supporting evidence, never a source of XP by themselves.
 *
 * TWO IMPLEMENTATIONS. The database computes the same result itself from the stored snapshots
 * (supabase/migrations/0019 game_mig_reconcile) and refuses to save or activate unless both agree exactly — the
 * owner's tool is never trusted with the numbers. Every rule here has its twin there: change both or neither
 * (the differential test in scripts/test-migration-admin.sh runs both on the same snapshots).
 *
 * No runtime imports: the owner's admin tool runs this file directly with Node (type stripping).
 */

/** Bumped whenever a rule changes (both implementations): a result of another version never matches. */
export const ALGORITHM = "q4.5-4/2";

/* ------------------------------------------------------------------ rules of the past (from git history) */

/**
 * First-action amounts. #98 (merged 2026-10-27 14:50 UTC) introduced them («before»); #99 (15:34 UTC) changed the
 * coins («after») and, in the SAME commit (3fb4566), started the coin log, which records every first action with its
 * kind and the amount actually paid. Never changed since (checked in every version of lib/game-config.ts).
 * So an amount is proven only by the coin log; a first action outside it may have been paid by either rule — the
 * smaller amount is confirmed and the difference goes to the legacy candidate (no deploy-time guess).
 * XP was the same under both rules.
 */
export const FIRST_ACTION_RULES = {
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

/**
 * The daily Coins cap (#98, lib/game.ts remainingDailyCoins): 100 a game day, never changed. It limited the Coins of
 * quests (missions included — every history entry) and of the daily reward together; first actions were outside it,
 * personal quests and journal actions pay no Coins. Before #98 there was no cap: days before sinceDay are not capped.
 * The day #98 shipped (2026-10-27) is capped as a whole — the cautious side: what it cuts stays in the candidate.
 */
export const DAILY_COIN_CAP = { amount: 100, sinceDay: "2026-10-27" };

/**
 * The largest single quest entry ever paid (every version of every file that ever reached completeQuest — the only
 * writer of the history in every version): QUEST_XP 40 / QUEST_COINS 10, catalog xpReward ≤ 50 / coinsReward ≤ 15,
 * self-reports ≤ their catalog XP. Above these an entry is out of rule (scan: docs/q4-5-4, section 3.3).
 */
export const QUEST_BOUNDS = { xp: 50, coins: 15 };

/**
 * A daily reward in the coin log: the coin log exists since #99, when the cap already did, so an amount is one of the
 * reward values (10, 10, 15, 15, 20, 25, 50 — never changed) or the cap's remainder below it: 1…50.
 */
export const DAILY_REWARD_BOUNDS = { min: 1, max: 50 };

/** Personal quest XP that ever existed (variant C, QH-8.5): app 100/180/250, self 50/90/125. */
export const PQ_XP: readonly number[] = [50, 90, 100, 125, 180, 250];

/* ------------------------------------------------------------------ types */

export interface Snapshot {
  snapshotId: string;
  installId: string;
  /** Server time of receipt (ISO) — shown, never used by a rule. */
  receivedAt?: string;
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
  | "first_action_unlogged"
  | "duplicate_in_snapshot"
  | "balance_below_records"
  | "level_xp_inconsistent"
  | "bad_record";

/**
 * Structured on purpose (no free text): the database computes the same list and the two must be equal.
 * Subjects: «<snapshot>/<key or field/index>» for what one snapshot says, «<key>» for what the devices say together,
 * «<snapshot>» for a snapshot as a whole.
 */
export interface Conflict {
  code: ConflictCode;
  subject: string;
  /** XP/Coins NOT confirmed because of it (they stay in the legacy candidate of the snapshot). */
  xp: number;
  coins: number;
}

export type ReasonCode = "journal_xp_by_day" | "screenshot_hashes" | "coins_before_log" | "legacy_format";

export interface Reason {
  code: ReasonCode;
  /** journal_xp_by_day: XP recorded per day beyond quests (journal actions) — no per-event record. */
  xp?: number;
  /** journal_xp_by_day: how many days; screenshot_hashes: how many hashes (a hash proves no amount and no day). */
  count?: number;
  /** coins_before_log: when the coin log starts (earlier Coins are only in the balance); absent: no coin log at all. */
  since?: string;
}

export interface LegacyCandidate {
  snapshotId: string;
  installId: string;
  original: { level: number; xpInLevel: number; totalXp: number; coins: number; saveVersion: string };
  /** What this snapshot's own records prove (after the cross-device minimum and the daily cap). */
  confirmed: { xp: number; coins: number };
  /** total − confirmed, never below 0 — a CANDIDATE only (see reasons). */
  candidate: { xp: number; coins: number };
  reasons: Reason[];
}

export interface Reconciliation {
  algorithm: string;
  /** The account's time zone the days were read in. */
  timeZone: string;
  /** Sorted «snapshot id:content md5» it was computed from. */
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
  /** Achievements unlocked on any snapshot (kept as they were; the server has no achievement table before Q4.6). */
  achievements: string[];
}

/* ------------------------------------------------------------------ strict readers (the SQL twin reads the same) */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_INT = 1_000_000_000;
const MAX_LEVEL = 1000;

/** A whole number 0…1e9 (anything else — a fraction, a string, a huge number — is not a record). */
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_INT;
/** A real calendar day of 2000…2100 written YYYY-MM-DD. */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
/** The exact form the game writes (Date.toISOString): YYYY-MM-DDTHH:MM:SS[.mmm]Z with a real date and time. */
export function isIsoTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_RE.exec(v);
  return !!m && isDay(m[1]) && Number(m[2]) <= 23 && Number(m[3]) <= 59 && Number(m[4]) <= 59;
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});
/** Byte order (as the database's COLLATE "C"); every compared string here is ASCII. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
/** Σ (80 + 40·n) for n < level, plus the XP in the level. */
export function totalXpOf(level: number, xpInLevel: number): number {
  return xpInLevel + 80 * (level - 1) + 20 * level * (level - 1);
}
/** The game day of a time in a zone (the account's time zone from its profile). */
export function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.parse(iso)));
}

/** Which save format this is (the fields old versions did not have). */
export function saveVersionOf(state: Record<string, unknown>): string {
  const marks = [
    arr(state.history).some((h) => typeof obj(h).at === "string") ? "history_at" : null,
    isObj(state.firstActions) ? "first_actions" : null,
    Array.isArray(state.coinLog) ? "coin_log" : null,
    isObj(state.missionLedger) ? "missions" : null,
    arr(state.personalLedger).some((e) => obj(e).paid === true) ? "pq_paid" : null,
  ].filter(Boolean);
  return marks.length ? marks.join("+") : "legacy";
}

/* ------------------------------------------------------------------ one snapshot: its records */

type OwnEvent = { kind: EventKind; day: string; xp: number; coins: number };

interface SnapshotRead {
  events: Map<string, OwnEvent>;
  conflicts: Conflict[];
  original: LegacyCandidate["original"];
  reasons: Reason[];
  achievements: string[];
}

function readSnapshot(s: Snapshot, timeZone: string): SnapshotRead {
  const st = s.state;
  const id = s.snapshotId;
  const events = new Map<string, OwnEvent>();
  const conflicts: Conflict[] = [];
  const level = isInt(st.level) && st.level >= 1 && st.level <= MAX_LEVEL ? st.level : 1;
  const xpInLevel = isInt(st.xp) ? st.xp : 0;
  const coins = isInt(st.coins) ? st.coins : 0;
  if (xpInLevel >= xpForNextLevel(level)) conflicts.push({ code: "level_xp_inconsistent", subject: id, xp: 0, coins: 0 });
  const original = { level, xpInLevel, totalXp: totalXpOf(level, xpInLevel), coins, saveVersion: saveVersionOf(st) };

  // quests and missions: the history (never pruned), amounts as actually paid (already capped on the device)
  arr(st.history).forEach((raw, i) => {
    const h = obj(raw);
    const day = h.completedAt;
    const questId = str(h.questId);
    if (!isDay(day) || questId === null || !ID_RE.test(questId) || !isInt(h.xp) || !isInt(h.coins)) {
      conflicts.push({ code: "bad_record", subject: `${id}/history/${i}`, xp: isInt(h.xp) ? h.xp : 0, coins: isInt(h.coins) ? h.coins : 0 });
      return;
    }
    const key = `quest:${day}:${questId}`;
    if (events.has(key)) return void conflicts.push({ code: "duplicate_in_snapshot", subject: `${id}/${key}`, xp: h.xp, coins: h.coins });
    if (h.xp > QUEST_BOUNDS.xp || h.coins > QUEST_BOUNDS.coins) return void conflicts.push({ code: "amount_out_of_rule", subject: `${id}/${key}`, xp: h.xp, coins: h.coins });
    events.set(key, { kind: "quest", day, xp: h.xp, coins: h.coins });
  });

  // first actions: the kind is the key; the amount is proven only by the coin log (see FIRST_ACTION_RULES)
  const coinLog = arr(st.coinLog).map(obj);
  for (const [kind, at] of Object.entries(obj(st.firstActions))) {
    const before = FIRST_ACTION_RULES.before[kind];
    const after = FIRST_ACTION_RULES.after[kind];
    if (!Object.prototype.hasOwnProperty.call(FIRST_ACTION_RULES.before, kind) || !before || !after || !isIsoTime(at)) {
      conflicts.push({ code: "bad_record", subject: `${id}/firstActions`, xp: 0, coins: 0 });
      continue;
    }
    const key = `first:${kind}`;
    const low = Math.min(before.coins, after.coins);
    const high = Math.max(before.coins, after.coins);
    const logged = coinLog.find((e) => e.source === "firstAction" && e.kind === kind);
    let paid = low;
    if (logged && logged.amount === after.coins) paid = after.coins;
    else if (logged) conflicts.push({ code: "amount_out_of_rule", subject: `${id}/${key}`, xp: 0, coins: high - low });
    else if (high > low) conflicts.push({ code: "first_action_unlogged", subject: `${id}/${key}`, xp: 0, coins: high - low });
    events.set(key, { kind: "first", day: dayIn(at, timeZone), xp: Math.min(before.xp, after.xp), coins: paid });
  }

  // personal quests: only completions that paid (QH-8.5); the run id is the key
  arr(st.personalLedger).forEach((raw, i) => {
    const e = obj(raw);
    if (e.paid !== true) return;
    const runId = str(e.runId);
    if (runId === null || !ID_RE.test(runId) || !isInt(e.xp) || !isDay(e.day)) {
      conflicts.push({ code: "bad_record", subject: `${id}/personalLedger/${i}`, xp: isInt(e.xp) ? e.xp : 0, coins: 0 });
      return;
    }
    const key = `pq:${runId}`;
    if (!PQ_XP.includes(e.xp)) return void conflicts.push({ code: "amount_out_of_rule", subject: `${id}/${key}`, xp: e.xp, coins: 0 });
    if (events.has(key)) return void conflicts.push({ code: "duplicate_in_snapshot", subject: `${id}/${key}`, xp: e.xp, coins: 0 });
    events.set(key, { kind: "pq", day: e.day, xp: e.xp, coins: 0 });
  });

  // daily rewards: only inside the coin log (500 entries, since coinLogSince); the game day in the account's zone
  coinLog.forEach((e, i) => {
    if (e.source !== "dailyReward") return;
    if (!isIsoTime(e.at) || !isInt(e.amount)) {
      conflicts.push({ code: "bad_record", subject: `${id}/coinLog/${i}`, xp: 0, coins: isInt(e.amount) ? e.amount : 0 });
      return;
    }
    const key = `daily:${dayIn(e.at, timeZone)}`;
    if (e.amount < DAILY_REWARD_BOUNDS.min || e.amount > DAILY_REWARD_BOUNDS.max) return void conflicts.push({ code: "amount_out_of_rule", subject: `${id}/${key}`, xp: 0, coins: e.amount });
    if (events.has(key)) return void conflicts.push({ code: "duplicate_in_snapshot", subject: `${id}/${key}`, xp: 0, coins: e.amount });
    events.set(key, { kind: "daily", day: key.slice(6), xp: 0, coins: e.amount });
  });

  // what is known about the rest (reasons of the legacy candidate; none of it is a proof)
  const reasons: Reason[] = [];
  const questXpByDay = new Map<string, number>();
  for (const ev of events.values()) if (ev.kind === "quest") questXpByDay.set(ev.day, (questXpByDay.get(ev.day) ?? 0) + ev.xp);
  let journalXp = 0;
  let journalDays = 0;
  for (const [day, raw] of Object.entries(obj(st.dailyStats))) {
    const gained = obj(raw).xpGained;
    if (!DAY_RE.test(day) || !isInt(gained)) continue;
    const rest = gained - (questXpByDay.get(day) ?? 0);
    if (rest > 0) {
      journalXp += rest;
      journalDays += 1;
    }
  }
  if (journalXp > 0) reasons.push({ code: "journal_xp_by_day", xp: journalXp, count: journalDays });
  const shots = arr(st.rewardedScreenshotHashes).length;
  if (shots > 0) reasons.push({ code: "screenshot_hashes", count: shots });
  const since = str(st.coinLogSince);
  reasons.push(since === null ? { code: "coins_before_log" } : { code: "coins_before_log", since });
  if (original.saveVersion === "legacy") reasons.push({ code: "legacy_format" });

  const achievements = Object.entries(obj(st.achievements)).filter(([k, v]) => v === true && ID_RE.test(k)).map(([k]) => k);
  return { events, conflicts, original, reasons, achievements };
}

/* ------------------------------------------------------------------ all snapshots of an account */

export function reconcile(snapshots: Snapshot[], timeZone: string, contentHashes: Record<string, string> = {}): Reconciliation {
  // an unknown zone throws here (and is refused by the database): never a silent fallback
  dayIn("2026-01-01T00:00:00Z", timeZone);
  const sorted = [...snapshots].sort((a, b) => cmp(a.snapshotId, b.snapshotId));
  const read = sorted.map((s) => ({ s, r: readSnapshot(s, timeZone) }));
  const conflicts: Conflict[] = read.flatMap(({ r }) => r.conflicts);

  // 1. the same key on several devices is ONE event; amounts must agree — the smaller is confirmed, the difference is not
  const byKey = new Map<string, Array<OwnEvent & { snap: string }>>();
  for (const { s, r } of read) for (const [key, ev] of r.events) byKey.set(key, [...(byKey.get(key) ?? []), { snap: s.snapshotId, ...ev }]);
  const events: ProvenEvent[] = [];
  for (const key of [...byKey.keys()].sort(cmp)) {
    const all = byKey.get(key)!;
    const xp = Math.min(...all.map((e) => e.xp));
    const coins = Math.min(...all.map((e) => e.coins));
    const maxXp = Math.max(...all.map((e) => e.xp));
    const maxCoins = Math.max(...all.map((e) => e.coins));
    if (maxXp !== xp || maxCoins !== coins) conflicts.push({ code: "amount_mismatch", subject: key, xp: maxXp - xp, coins: maxCoins - coins });
    events.push({ key, kind: all[0].kind, day: all.map((e) => e.day).sort(cmp)[0], xp, coins, sources: all.map((e) => e.snap).sort(cmp) });
  }

  // 2. the daily Coins cap over ALL devices together (after 1: each event once) — the account had one cap, not one per
  // device. Above it the Coins of the day are cut from the highest key down (a fixed order, not the snapshots' order);
  // the cut part is a conflict and stays in the candidate of the snapshots that carry it.
  const cappedDays = [...new Set(events.filter((e) => e.day >= DAILY_COIN_CAP.sinceDay && (e.kind === "quest" || e.kind === "daily")).map((e) => e.day))].sort(cmp);
  for (const day of cappedDays) {
    const ofDay = events.filter((e) => e.day === day && (e.kind === "quest" || e.kind === "daily"));
    let excess = ofDay.reduce((a, e) => a + e.coins, 0) - DAILY_COIN_CAP.amount;
    for (const e of [...ofDay].sort((a, b) => cmp(b.key, a.key))) {
      if (excess <= 0) break;
      const cut = Math.min(e.coins, excess);
      if (cut <= 0) continue;
      e.coins -= cut;
      excess -= cut;
      conflicts.push({ code: "daily_coin_cap", subject: e.key, xp: 0, coins: cut });
    }
  }

  // 3. a legacy CANDIDATE per snapshot: what its total exceeds its own proven events by — never credited by itself
  const legacy: LegacyCandidate[] = read.map(({ s, r }) => {
    const own = events.filter((e) => e.sources.includes(s.snapshotId));
    const confirmed = { xp: own.reduce((a, e) => a + e.xp, 0), coins: own.reduce((a, e) => a + e.coins, 0) };
    const dx = r.original.totalXp - confirmed.xp;
    const dc = r.original.coins - confirmed.coins;
    if (dx < 0 || dc < 0) conflicts.push({ code: "balance_below_records", subject: s.snapshotId, xp: 0, coins: 0 });
    return { snapshotId: s.snapshotId, installId: s.installId, original: r.original, confirmed, candidate: { xp: Math.max(0, dx), coins: Math.max(0, dc) }, reasons: r.reasons };
  });

  const confirmedXp = events.reduce((a, e) => a + e.xp, 0);
  const confirmedCoins = events.reduce((a, e) => a + e.coins, 0);
  const level = levelForTotalXp(confirmedXp);
  const originalLevel = Math.max(1, ...read.map(({ r }) => r.original.level));
  return {
    algorithm: ALGORITHM,
    timeZone,
    inputs: sorted.map((s) => `${s.snapshotId}:${contentHashes[s.snapshotId] ?? ""}`),
    events,
    conflicts: conflicts.sort((a, b) => cmp(a.code, b.code) || cmp(a.subject, b.subject) || a.xp - b.xp || a.coins - b.coins),
    legacy,
    proposed: { confirmedXp, confirmedCoins, level, originalLevel, levelGap: Math.max(0, originalLevel - level), originalCoins: Math.max(0, ...read.map(({ r }) => r.original.coins)) },
    achievements: [...new Set(read.flatMap(({ r }) => r.achievements))].sort(cmp),
  };
}

/**
 * V3 (owner decision: evidence only): cloud Journal records attached to the journal XP of a legacy candidate. A record
 * existing on a day does not prove a reward was given, nor when; edits and imports never become rewards. The result
 * is shown to the reviewer next to the candidate — it never changes a number.
 */
export function journalEvidence(candidate: LegacyCandidate, cloudRecordDays: Record<string, number>): { day: string; recordsThatDay: number }[] {
  const days = candidate.reasons.find((r) => r.code === "journal_xp_by_day") ? Object.keys(cloudRecordDays).sort(cmp) : [];
  return days.map((day) => ({ day, recordsThatDay: cloudRecordDays[day] }));
}
