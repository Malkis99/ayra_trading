import { NEW_YORK, wallToUtc } from "./time";
import type { ScheduleMeta } from "./types";

/** One calendar entry from an .ics file (BEA's release schedule). */
export interface IcsEvent {
  summary: string;
  /** ms, UTC */
  start: number;
  uid: string | null;
  meta?: ScheduleMeta;
}

const TZ_ALIASES: Record<string, string> = { "US-Eastern": NEW_YORK, "US/Eastern": NEW_YORK };

/** Folded lines (a leading space continues the previous one) joined, escapes undone. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** `DTSTART:20261125T133000Z`, `DTSTART;VALUE=DATE-TIME:…Z`, `DTSTART;TZID=US-Eastern:20250110T083000` → ms. */
export function parseDtStart(line: string): number | null {
  const m = line.match(/^DTSTART((?:;[^:]+)*):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, params, y, mo, d, h, mi, sec, z] = m;
  if (+h > 23 || +mi > 59 || +sec > 59 || new Date(Date.UTC(+y, +mo - 1, +d)).toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null;
  if (z) return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  const tzid = params.match(/TZID=([^;:]+)/)?.[1];
  const zone = tzid ? TZ_ALIASES[tzid] ?? tzid : null;
  if (!zone) return null; // floating time: we cannot know the zone, so we do not guess
  try {
    const at = wallToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, zone);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    if (get("year") !== y || get("month") !== mo || get("day") !== d || get("hour") !== h || get("minute") !== mi) return null;
    return at + +sec * 1000;
  } catch {
    return null;
  }
}

type RawEvent = { summary?: string; start?: number | null; day?: string | null; uid?: string; meta?: ScheduleMeta };

function events(ics: string): RawEvent[] {
  const out: RawEvent[] = [];
  let cur: RawEvent | null = null;
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) {
      if (line.startsWith("SUMMARY")) cur.summary = unescape(line.slice(line.indexOf(":") + 1));
      else if (line.startsWith("DTSTART")) {
        cur.start = parseDtStart(line);
        const day = line.match(/^DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})$/);
        cur.day = day ? `${day[1]}-${day[2]}-${day[3]}` : null;
        if (day && new Date(Date.UTC(+day[1],+day[2]-1,+day[3])).toISOString().slice(0,10) !== cur.day) cur.day = null;
      } else if (line.startsWith("UID:")) cur.uid = line.slice(4).trim();
      else if (/^SEQUENCE:\d+$/.test(line)) cur.meta = { ...cur.meta, sequence: Number(line.slice(9)) };
      else if (line.startsWith("LAST-MODIFIED")) {
        const at = parseDtStart(line.replace(/^LAST-MODIFIED/, "DTSTART"));
        if (at !== null) cur.meta = { ...cur.meta, modified: new Date(at).toISOString() };
      } else if (/^STATUS:(CANCELLED|CONFIRMED|TENTATIVE)$/.test(line)) cur.meta = { ...cur.meta, cancelled: line === "STATUS:CANCELLED" };
    }
  }
  return out;
}

/** Entries with a time (all-day entries are left out: their hour is unknown). */
export function parseIcs(ics: string): IcsEvent[] {
  return events(ics)
    .filter((e): e is RawEvent & { summary: string; start: number } => !!e.summary && typeof e.start === "number")
    .map((e) => ({ summary: e.summary, start: e.start, uid: e.uid ?? null, ...(e.meta ? { meta: e.meta } : {}) }));
}

/** All-day entries (`DTSTART;VALUE=DATE:20261104`): the day only, as Eurostat's release calendar gives it. */
export function parseIcsDays(ics: string): { summary: string; day: string; uid?: string; meta?: ScheduleMeta }[] {
  return events(ics)
    .filter((e): e is RawEvent & { summary: string; day: string } => !!e.summary && !!e.day)
    .map((e) => ({ summary: e.summary, day: e.day, ...(e.uid ? { uid: e.uid } : {}), ...(e.meta ? { meta: e.meta } : {}) }));
}

/** Cancellation notices may omit DTSTART; their existing UID must still be actionable. */
export function icsCancellations(ics: string): { uid: string; meta: ScheduleMeta }[] {
  return events(ics).filter((e) => e.uid && e.meta?.cancelled && !e.start && !e.day).map((e) => ({ uid: e.uid!, meta: e.meta! }));
}
