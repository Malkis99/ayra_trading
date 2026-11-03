import { instantOf } from "../sessions";

/**
 * Times in the official feeds, all made UTC:
 * RSS `pubDate` (`Wed, 28 Oct 2026 18:00:00 GMT`, `… +0100`, `… Z`, `… EDT`), ISO 8601 (Atom), and the wall time
 * of a zone (`US/Eastern` 08:30, `Europe/Frankfurt` 14:15) via the site's own zone arithmetic (summer time included).
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ZONES: Record<string, number> = { gmt: 0, ut: 0, utc: 0, z: 0, edt: -4 * 60, est: -5 * 60, cdt: -5 * 60, cst: -6 * 60, cet: 60, cest: 120, bst: 60, jst: 540 };

/** `Wed, 28 Oct 2026 18:00:00 GMT` → ms (UTC), or null. */
export function parseRfc822(s: string | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([A-Za-z]+|[+-]\d{4})?$/);
  if (!m) return null;
  const [, d, mon, y, h, mi, sec, zone] = m;
  const month = MONTHS[mon.toLowerCase()];
  if (!month) return null;
  let offset = 0;
  if (zone) {
    if (/^[+-]\d{4}$/.test(zone)) {
      const sign = zone[0] === "-" ? -1 : 1;
      offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
    } else {
      const z = ZONES[zone.toLowerCase()];
      if (z === undefined) return null;
      offset = z;
    }
  }
  return Date.UTC(Number(y), month - 1, Number(d), Number(h), Number(mi), Number(sec ?? 0)) - offset * 60_000;
}

/** RSS or ISO date → ms (UTC), or null. */
export function parseFeedDate(s: string | null): number | null {
  if (!s) return null;
  const rfc = parseRfc822(s);
  if (rfc !== null) return rfc;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.trim())) {
    const ms = Date.parse(s.trim());
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export const NEW_YORK = "America/New_York";
export const FRANKFURT = "Europe/Berlin";

/** A wall time in a zone (`2026-11-06`, `08:30`) → ms (UTC). */
export function wallToUtc(date: string, time: string, zone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return instantOf(y, mo, d, h, mi, zone);
}

export const isoUtc = (ms: number) => new Date(ms).toISOString();
/** The UTC day of an instant, `2026-11-06`. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The New York day of an instant (US releases are dated by it). */
export function nyDay(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  return parts;
}
