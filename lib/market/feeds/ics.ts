import { NEW_YORK, wallToUtc } from "./time";

/** One calendar entry from an .ics file (BEA's release schedule). */
export interface IcsEvent {
  summary: string;
  /** ms, UTC */
  start: number;
  uid: string | null;
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
  const [, params, y, mo, d, h, mi, , z] = m;
  if (z) return Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const tzid = params.match(/TZID=([^;:]+)/)?.[1];
  const zone = tzid ? TZ_ALIASES[tzid] ?? tzid : null;
  if (!zone) return null; // floating time: we cannot know the zone, so we do not guess
  try {
    return wallToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, zone);
  } catch {
    return null;
  }
}

type RawEvent = { summary?: string; start?: number | null; day?: string | null; uid?: string };

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
      } else if (line.startsWith("UID:")) cur.uid = line.slice(4).trim();
    }
  }
  return out;
}

/** Entries with a time (all-day entries are left out: their hour is unknown). */
export function parseIcs(ics: string): IcsEvent[] {
  return events(ics)
    .filter((e): e is RawEvent & { summary: string; start: number } => !!e.summary && typeof e.start === "number")
    .map((e) => ({ summary: e.summary, start: e.start, uid: e.uid ?? null }));
}

/** All-day entries (`DTSTART;VALUE=DATE:20261104`): the day only, as Eurostat's release calendar gives it. */
export function parseIcsDays(ics: string): { summary: string; day: string }[] {
  return events(ics)
    .filter((e): e is RawEvent & { summary: string; day: string } => !!e.summary && !!e.day)
    .map((e) => ({ summary: e.summary, day: e.day }));
}
