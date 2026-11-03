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

export function parseIcs(ics: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: { summary?: string; start?: number | null; uid?: string } | null = null;
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.summary && typeof cur.start === "number") out.push({ summary: cur.summary, start: cur.start, uid: cur.uid ?? null });
      cur = null;
    } else if (cur) {
      if (line.startsWith("SUMMARY")) cur.summary = unescape(line.slice(line.indexOf(":") + 1));
      else if (line.startsWith("DTSTART")) cur.start = parseDtStart(line);
      else if (line.startsWith("UID:")) cur.uid = line.slice(4).trim();
    }
  }
  return out;
}
