/**
 * Trading sessions and killzones (Market → Overview, plan `docs/market-plan.md`, PR 1.1 / 1.1b). No market data:
 * only clocks. Each window is defined in the wall time of its own city, so summer time of every country (switching
 * on different dates) is followed by itself; the user sees it in the time zone chosen for display.
 *
 * The forex week: opens Sunday 17:00 New York time, closes Friday 17:00 New York time. A window is cut to it: it is
 * never shown open while the forex market is closed (e.g. New York on Friday closes at 17:00, not at 18:00).
 */

export type MainSessionId = "asia" | "london" | "newyork";
export type SubSessionId = "sydney" | "wellington" | "hongkong" | "frankfurt" | "chicago";
export type SessionId = MainSessionId | SubSessionId;
export type KillzoneId = "londonKz" | "newyorkKz";
export type WindowId = SessionId | KillzoneId;
/** Region of a session, for its short description. */
export type SessionGroup = "pacific" | "asia" | "europe" | "america";

/** "HH:MM" in the wall time of `zone`; an end before the start means the next day. */
export interface WindowDef {
  id: WindowId;
  kind: "session" | "killzone";
  zone: string;
  start: string;
  end: string;
  group?: SessionGroup;
}

export const NEW_YORK = "America/New_York";

export const MAIN_SESSIONS: MainSessionId[] = ["asia", "london", "newyork"];
export const SUB_SESSIONS: SubSessionId[] = ["sydney", "wellington", "hongkong", "frankfurt", "chicago"];
export const ALL_SESSIONS: SessionId[] = [...MAIN_SESSIONS, ...SUB_SESSIONS];

/**
 * Default hours in each city's own time (owner's table 2026-10-28, given in UTC+3 for the northern summer):
 * Tokyo, Hong Kong, Frankfurt, London, Wellington, Sydney 08:00–17:00; New York 09:30–18:00; Chicago 09:00–18:00.
 */
export const SESSION_DEFAULTS: Record<SessionId, { zone: string; group: SessionGroup; start: string; end: string }> = {
  asia: { zone: "Asia/Tokyo", group: "asia", start: "08:00", end: "17:00" },
  london: { zone: "Europe/London", group: "europe", start: "08:00", end: "17:00" },
  newyork: { zone: NEW_YORK, group: "america", start: "09:30", end: "18:00" },
  sydney: { zone: "Australia/Sydney", group: "pacific", start: "08:00", end: "17:00" },
  wellington: { zone: "Pacific/Auckland", group: "pacific", start: "08:00", end: "17:00" },
  hongkong: { zone: "Asia/Hong_Kong", group: "asia", start: "08:00", end: "17:00" },
  frankfurt: { zone: "Europe/Berlin", group: "europe", start: "08:00", end: "17:00" },
  chicago: { zone: "America/Chicago", group: "america", start: "09:00", end: "18:00" },
};

export type Hours = { start: string; end: string };
export type SessionSettings = Record<SessionId, Hours>;
export type KillzoneSettings = Record<KillzoneId, Hours>;

export const DEFAULT_KILLZONES: KillzoneSettings = {
  londonKz: { start: "02:00", end: "05:00" },
  newyorkKz: { start: "07:00", end: "10:00" },
};

export function defaultSessionHours(): SessionSettings {
  return Object.fromEntries(ALL_SESSIONS.map((id) => [id, { start: SESSION_DEFAULTS[id].start, end: SESSION_DEFAULTS[id].end }])) as SessionSettings;
}

/** Session windows with the user's hours (city local time). */
export function sessionDefs(hours: SessionSettings = defaultSessionHours()): Record<SessionId, WindowDef> {
  return Object.fromEntries(
    ALL_SESSIONS.map((id) => [id, { id, kind: "session", zone: SESSION_DEFAULTS[id].zone, group: SESSION_DEFAULTS[id].group, start: hours[id].start, end: hours[id].end }])
  ) as Record<SessionId, WindowDef>;
}

/** The three main sessions with the default hours (Tokyo, London, New York). */
export const SESSIONS: WindowDef[] = MAIN_SESSIONS.map((id) => sessionDefs()[id]);

/** Killzones are kept in New York time (as they are usually described). */
export function killzoneDefs(settings: KillzoneSettings = DEFAULT_KILLZONES): WindowDef[] {
  return (["londonKz", "newyorkKz"] as const).map((id) => ({ id, kind: "killzone", zone: NEW_YORK, start: settings[id].start, end: settings[id].end }));
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isValidTime = (v: string) => HHMM.test(v);

/** Hours of a window: both «HH:MM», start ≠ end; an end before the start crosses midnight. */
export function isValidWindow(start: string, end: string): boolean {
  return isValidTime(start) && isValidTime(end) && start !== end;
}

function normalizeHours<K extends string>(raw: unknown, defaults: Record<K, Hours>): Record<K, Hours> {
  const out = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { ...(v as Hours) }])) as Record<K, Hours>;
  if (!raw || typeof raw !== "object") return out;
  for (const id of Object.keys(defaults) as K[]) {
    const v = (raw as Record<string, unknown>)[id] as { start?: unknown; end?: unknown } | undefined;
    if (v && typeof v.start === "string" && typeof v.end === "string" && isValidWindow(v.start, v.end)) out[id] = { start: v.start, end: v.end };
  }
  return out;
}

/** Settings read back from storage: anything broken falls back to the default of that killzone. */
export function normalizeKillzones(raw: unknown): KillzoneSettings {
  return normalizeHours(raw, DEFAULT_KILLZONES);
}

export function normalizeSessionHours(raw: unknown): SessionSettings {
  return normalizeHours(raw, defaultSessionHours());
}

// ---- Display time zone ----

/** New York (default), the profile's zone, UTC, or any zone from the list. No fixed «UTC+N» choices. */
export type DisplayChoice = { kind: "newyork" } | { kind: "profile" } | { kind: "utc" } | { kind: "zone"; zone: string };
export const DEFAULT_DISPLAY: DisplayChoice = { kind: "newyork" };

export function displayZoneOf(choice: DisplayChoice, profileZone: string): string {
  if (choice.kind === "profile") return profileZone;
  if (choice.kind === "utc") return "UTC";
  if (choice.kind === "zone") return choice.zone;
  return NEW_YORK;
}

const isZone = (z: unknown): z is string => {
  if (typeof z !== "string" || !z) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

export function normalizeDisplay(raw: unknown): DisplayChoice {
  const v = raw as { kind?: unknown; zone?: unknown } | null;
  if (v && (v.kind === "newyork" || v.kind === "profile" || v.kind === "utc")) return { kind: v.kind };
  if (v && v.kind === "zone" && isZone(v.zone)) return { kind: "zone", zone: v.zone };
  return DEFAULT_DISPLAY;
}

/** Everything the sessions block keeps on the device. */
export interface MarketSessionsSettings {
  display: DisplayChoice;
  sessions: SessionSettings;
  killzones: KillzoneSettings;
}

/** Read back: the new settings, or the killzones saved before 1.1b (kept, not lost). */
export function normalizeSettings(raw: unknown, legacyKillzones?: unknown): MarketSessionsSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MarketSessionsSettings, unknown>>;
  return {
    display: normalizeDisplay(v.display),
    sessions: normalizeSessionHours(v.sessions),
    killzones: normalizeKillzones(v.killzones ?? legacyKillzones),
  };
}

// ---- Time zone arithmetic (Intl only) ----

interface Wall {
  y: number;
  mo: number; // 1–12
  d: number;
  h: number;
  mi: number;
  wd: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    formatters.set(zone, f);
  }
  return f;
}

/** Wall clock of `zone` at the instant `ms`. */
export function wallAt(ms: number, zone: string): Wall {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute, wd: WEEKDAYS.indexOf(parts.weekday) };
}

/** The instant when the wall clock of `zone` shows this date and time (the hour skipped by summer time moves on). */
export function instantOf(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = wallAt(guess, zone);
    const shown = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
    if (shown === target) return guess;
    guess += target - shown;
  }
  return guess;
}

/** «HH:MM» of one zone at the reference day → the same instant in another zone (today's offsets). */
export function convertClock(hhmm: string, fromZone: string, toZone: string, refMs: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const day = wallAt(refMs, fromZone);
  return clockOf(instantOf(day.y, day.mo, day.d, h, m, fromZone), toZone);
}

// ---- Forex week ----

/** Is the forex market open at `ms` (Sunday 17:00 – Friday 17:00 New York time)? */
export function isForexOpen(ms: number): boolean {
  const w = wallAt(ms, NEW_YORK);
  const min = w.h * 60 + w.mi;
  if (w.wd === 6) return false;
  if (w.wd === 5) return min < 17 * 60;
  if (w.wd === 0) return min >= 17 * 60;
  return true;
}

/** The first New York 17:00 on weekday `wd` (0 Sunday, 5 Friday) at or after `ms`. */
function nextNewYork17(ms: number, wd: number): number {
  const w = wallAt(ms, NEW_YORK);
  let days = (wd - w.wd + 7) % 7;
  if (days === 0 && w.h * 60 + w.mi >= 17 * 60) days = 7;
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + days));
  return instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 17, 0, NEW_YORK);
}

/** The forex week opens (Sunday 17:00 New York) — next time after `ms`. */
export const nextForexOpen = (ms: number) => nextNewYork17(ms, 0);
/** The forex week closes (Friday 17:00 New York) — next time after `ms`. */
export const nextForexClose = (ms: number) => nextNewYork17(ms, 5);

// ---- Occurrences of a window ----

export interface Occurrence {
  id: WindowId;
  start: number;
  end: number;
}

/**
 * Occurrences of a window around `ms` (from a day before to `days` after). Two rules for the weekend:
 * - a window happens only on the working days of its own city (Monday–Friday local): no New York «session» on
 *   Sunday evening just because the market opens at 17:00 New York;
 * - it is cut to the forex week: one that starts while the market is closed begins when it opens (Sunday 17:00
 *   New York, e.g. Sydney's or Wellington's Monday morning), one that runs past Friday 17:00 New York ends there.
 */
export function occurrences(def: WindowDef, ms: number, days = 8): Occurrence[] {
  const [sh, sm] = def.start.split(":").map(Number);
  const [eh, em] = def.end.split(":").map(Number);
  const overnight = eh * 60 + em <= sh * 60 + sm;
  const out: Occurrence[] = [];
  const today = wallAt(ms, def.zone);
  for (let i = -1; i <= days; i++) {
    // calendar day in the window's own city (Date.UTC normalises the overflow of the day)
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const endDay = new Date(Date.UTC(today.y, today.mo - 1, today.d + i + (overnight ? 1 : 0)));
    let start = instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), sh, sm, def.zone);
    let end = instantOf(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), eh, em, def.zone);
    if (!isForexOpen(start)) start = nextForexOpen(start);
    if (start >= end) continue;
    end = Math.min(end, nextForexClose(start));
    out.push({ id: def.id, start, end });
  }
  return out;
}

/** A window, or the London + New York overlap. */
export type StatusId = WindowId | "overlap";

export type WindowStatus =
  | { state: "open"; id: StatusId; start: number; end: number }
  | { state: "closed"; id: StatusId; next: Occurrence | null; weekend: boolean };

/** Open now, or the next opening, from a list of occurrences (sorted by start). */
export function statusFromList(id: StatusId, list: Occurrence[], ms: number): WindowStatus {
  const now = list.find((o) => o.start <= ms && ms < o.end);
  if (now) return { state: "open", id, start: now.start, end: now.end };
  return { state: "closed", id, next: list.find((o) => o.start > ms) ?? null, weekend: !isForexOpen(ms) };
}

/** Open now (until when) or closed (next opening, whether it is the weekend). */
export function windowStatus(def: WindowDef, ms: number): WindowStatus {
  return statusFromList(def.id, occurrences(def, ms), ms);
}

/** Pieces of the occurrences that fall into [from, to) — for the bar of the user's day. */
export function windowsInRange(def: WindowDef, from: number, to: number): Occurrence[] {
  return occurrences(def, from, 2)
    .filter((o) => o.end > from && o.start < to)
    .map((o) => ({ ...o, start: Math.max(o.start, from), end: Math.min(o.end, to) }));
}

/** Start and end of the user's calendar day containing `ms`. */
export function dayBounds(ms: number, zone: string): { from: number; to: number } {
  const w = wallAt(ms, zone);
  const from = instantOf(w.y, w.mo, w.d, 0, 0, zone);
  const next = new Date(Date.UTC(w.y, w.mo - 1, w.d + 1));
  const to = instantOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, zone);
  return { from, to };
}

/** "HH:MM" of the instant on the user's clock. */
export function clockOf(ms: number, zone: string): string {
  const w = wallAt(ms, zone);
  return `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
}

/** Duration split for «in 1 h 20 min»: whole days, hours, minutes (rounded up to the minute). */
export function splitDuration(ms: number): { d: number; h: number; m: number } {
  const total = Math.max(0, Math.ceil(ms / 60_000));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

// ---- Readability helpers (PR 1.1a): overlap, one interval per window, the London–New York gap ----

/** When London and New York are open at the same time (intersections of their occurrences), with the user's hours. */
export function londonNewYorkOverlap(ms: number, days = 8, london: WindowDef = SESSIONS[1], newYork: WindowDef = SESSIONS[2]): Occurrence[] {
  const lon = occurrences(london, ms, days);
  const ny = occurrences(newYork, ms, days);
  const out: Occurrence[] = [];
  for (const a of lon)
    for (const b of ny) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (start < end) out.push({ id: "london", start, end });
    }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * The occurrence to name for the user's day [from, to): the one starting that day, otherwise the one still running
 * from the day before. Null when the window does not touch the day.
 */
export function primaryOccurrence(list: Occurrence[], from: number, to: number): Occurrence | null {
  return list.find((o) => o.start >= from && o.start < to) ?? list.find((o) => o.end > from && o.start < to) ?? null;
}

/** One interval on the user's clock, «16:00–01:00 (+1)»; a start on the day before gets «(−1)». */
export function intervalLabel(o: Occurrence, zone: string, from: number, to: number): string {
  const start = `${clockOf(o.start, zone)}${o.start < from ? " (−1)" : ""}`;
  const end = `${clockOf(o.end, zone)}${o.end > to ? " (+1)" : ""}`;
  return `${start}–${end}`;
}

/** Hours between the London and New York openings on this calendar date (London's date): 5, or 4 when only one side moved its clocks. */
export function londonNewYorkGapHours(ms: number): number {
  const w = wallAt(ms, "Europe/London");
  const london = instantOf(w.y, w.mo, w.d, 8, 0, "Europe/London");
  const ny = instantOf(w.y, w.mo, w.d, 8, 0, NEW_YORK);
  return Math.round((ny - london) / 3600_000);
}

/** The first date (an instant on that day) when the gap is back to the usual 5 hours; null if it already is. */
export function gapBackToUsual(ms: number, maxDays = 60): number | null {
  if (londonNewYorkGapHours(ms) === 5) return null;
  for (let i = 1; i <= maxDays; i++) {
    const t = ms + i * 24 * 3600_000;
    if (londonNewYorkGapHours(t) === 5) {
      const w = wallAt(t, "Europe/London");
      return instantOf(w.y, w.mo, w.d, 12, 0, "Europe/London");
    }
  }
  return null;
}

// ---- Live view (PR 1.1b): cards and «What is next». Only presentation; the hours above are unchanged ----

const HOUR = 3600_000;

/** The occurrence open now, or the next one. */
export function currentOrNext(list: Occurrence[], now: number): Occurrence | null {
  return list.find((o) => o.start <= now && now < o.end) ?? list.find((o) => o.start > now) ?? null;
}

/** Days from the user's today to the day of `ms` on the user's clock (0 today, 1 tomorrow, −1 yesterday). */
export function dayOffset(ms: number, now: number, zone: string): number {
  const a = wallAt(now, zone);
  const b = wallAt(ms, zone);
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / (24 * HOUR));
}

/** «16:00–01:00 (+1)» counted from the occurrence's own start day. */
export function hoursOf(o: Occurrence, zone: string): string {
  const days = dayOffset(o.end - 1, o.start, zone);
  return `${clockOf(o.start, zone)}–${clockOf(o.end, zone)}${days > 0 ? ` (+${days})` : ""}`;
}

/** A countdown: days and «HH:MM:SS» (rounded up to the second, never negative). */
export function countdown(ms: number): { d: number; hms: string } {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const rest = total % 86400;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { d, hms: `${pad(Math.floor(rest / 3600))}:${pad(Math.floor((rest % 3600) / 60))}:${pad(rest % 60)}` };
}

/** Share of the occurrence already passed at `now` (0…1); 0 before it starts. */
export function progressOf(o: Occurrence, now: number): number {
  if (now <= o.start) return 0;
  if (now >= o.end) return 1;
  return (now - o.start) / (o.end - o.start);
}

export interface UpcomingEvent {
  id: WindowId;
  kind: "session" | "killzone";
  edge: "start" | "end";
  at: number;
}

/** The next `limit` openings / closings of sessions and starts / ends of killzones after `now`, in order. */
export function upcomingEvents(defs: WindowDef[], now: number, limit = 5): UpcomingEvent[] {
  const out: UpcomingEvent[] = [];
  for (const d of defs)
    for (const o of occurrences(d, now)) {
      if (o.start > now) out.push({ id: d.id, kind: d.kind, edge: "start", at: o.start });
      if (o.end > now) out.push({ id: d.id, kind: d.kind, edge: "end", at: o.end });
    }
  // at the same minute a closing comes before an opening; otherwise the order of `defs` stays
  const rank = (e: UpcomingEvent) => (e.edge === "end" ? 0 : 1);
  return out.sort((a, b) => a.at - b.at || rank(a) - rank(b)).slice(0, limit);
}
