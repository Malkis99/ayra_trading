/**
 * Trading sessions and killzones (Market → Overview, plan `docs/market-plan.md`, PR 1.1). No market data: only
 * clocks. Each window is defined in the wall time of its own city, so summer time of Europe and of the USA (switching
 * on different dates) is followed by itself; the user sees it in their own time zone.
 *
 * The forex week: opens Sunday 17:00 New York time, closes Friday 17:00 New York time. A window that falls outside
 * it (e.g. Tokyo on Saturday morning) does not happen.
 */

export type SessionId = "asia" | "london" | "newyork";
export type KillzoneId = "londonKz" | "newyorkKz";
export type WindowId = SessionId | KillzoneId;

/** "HH:MM" in the wall time of `zone`. */
export interface WindowDef {
  id: WindowId;
  kind: "session" | "killzone";
  zone: string;
  start: string;
  end: string;
}

export const NEW_YORK = "America/New_York";

/**
 * Default hours — common conventions of the forex market, not business numbers: Tokyo 09:00–18:00, London and
 * New York 08:00–17:00 local time. Killzones are counted in New York time (as they are usually described):
 * London 02:00–05:00, New York 07:00–10:00; the user can change both.
 */
export const SESSIONS: WindowDef[] = [
  { id: "asia", kind: "session", zone: "Asia/Tokyo", start: "09:00", end: "18:00" },
  { id: "london", kind: "session", zone: "Europe/London", start: "08:00", end: "17:00" },
  { id: "newyork", kind: "session", zone: NEW_YORK, start: "08:00", end: "17:00" },
];

export const DEFAULT_KILLZONES: Record<KillzoneId, { start: string; end: string }> = {
  londonKz: { start: "02:00", end: "05:00" },
  newyorkKz: { start: "07:00", end: "10:00" },
};

export type KillzoneSettings = Record<KillzoneId, { start: string; end: string }>;

export function killzoneDefs(settings: KillzoneSettings = DEFAULT_KILLZONES): WindowDef[] {
  return (["londonKz", "newyorkKz"] as const).map((id) => ({ id, kind: "killzone", zone: NEW_YORK, start: settings[id].start, end: settings[id].end }));
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isValidTime = (v: string) => HHMM.test(v);
const minutesOf = (v: string) => {
  const m = HHMM.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** A killzone of the user: both times valid, start before end (a window does not cross midnight). */
export function isValidWindow(start: string, end: string): boolean {
  return isValidTime(start) && isValidTime(end) && minutesOf(start) < minutesOf(end);
}

/** Settings read back from storage: anything broken falls back to the default of that killzone. */
export function normalizeKillzones(raw: unknown): KillzoneSettings {
  const out: KillzoneSettings = { londonKz: { ...DEFAULT_KILLZONES.londonKz }, newyorkKz: { ...DEFAULT_KILLZONES.newyorkKz } };
  if (!raw || typeof raw !== "object") return out;
  for (const id of ["londonKz", "newyorkKz"] as const) {
    const v = (raw as Record<string, unknown>)[id] as { start?: unknown; end?: unknown } | undefined;
    if (v && typeof v.start === "string" && typeof v.end === "string" && isValidWindow(v.start, v.end)) out[id] = { start: v.start, end: v.end };
  }
  return out;
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

// ---- Occurrences of a window ----

export interface Occurrence {
  id: WindowId;
  start: number;
  end: number;
}

/** Occurrences of a window around `ms` (from a day before to `days` after), only inside the forex week. */
export function occurrences(def: WindowDef, ms: number, days = 8): Occurrence[] {
  const [sh, sm] = def.start.split(":").map(Number);
  const [eh, em] = def.end.split(":").map(Number);
  const out: Occurrence[] = [];
  const today = wallAt(ms, def.zone);
  for (let i = -1; i <= days; i++) {
    // calendar day in the window's own city (Date.UTC normalises the overflow of the day)
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const start = instantOf(y, mo, d, sh, sm, def.zone);
    const end = instantOf(y, mo, d, eh, em, def.zone);
    if (!isForexOpen(start) && !isForexOpen(end - 60_000)) continue;
    out.push({ id: def.id, start, end });
  }
  return out;
}

export type WindowStatus =
  | { state: "open"; id: WindowId; start: number; end: number }
  | { state: "closed"; id: WindowId; next: Occurrence | null; weekend: boolean };

/** Open now (until when) or closed (next opening, whether it is the weekend). */
export function windowStatus(def: WindowDef, ms: number): WindowStatus {
  const list = occurrences(def, ms);
  const now = list.find((o) => o.start <= ms && ms < o.end);
  if (now) return { state: "open", id: def.id, start: now.start, end: now.end };
  return { state: "closed", id: def.id, next: list.find((o) => o.start > ms) ?? null, weekend: !isForexOpen(ms) };
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
