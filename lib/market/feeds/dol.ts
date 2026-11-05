import type { EventResult } from "./types";
import { DOL_PAGE } from "./schedules-us";
import { claimsWeekEnding } from "./schedules-us";
import { NEW_YORK, wallToUtc, isoUtc } from "./time";

/**
 * DOL's weekly claims: the current news release (https://www.dol.gov/ui/data.pdf, a public-domain government work).
 * Its first paragraph gives the headline: «In the week ending October 24, the advance figure for seasonally adjusted
 * initial claims was 194,000 … The previous week's level was revised up by 1,000 from 194,000 to 195,000». DOL's
 * data download lags the release by weeks, so the release itself is read. The embargo line names the release day,
 * so an old release is never taken for a new one.
 */
export const DOL_RELEASE_URL = DOL_PAGE;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const isoOf = (month: string, day: string, year: string) => {
  const mo = MONTHS.indexOf(month.toLowerCase()) + 1;
  return mo ? `${year}-${String(mo).padStart(2, "0")}-${day.padStart(2, "0")}` : null;
};
const thousands = (s: string) => `${Number(s.replace(/,/g, "")) / 1000}K`;

export interface ClaimsRelease {
  /** release day, `2026-10-29` */
  day: string;
  actual: string;
  previous: string | null;
  period?: string;
}

/** The release's text → its day and headline figures, or null when the wording is not found. */
export function parseClaims(text: string): ClaimsRelease | null {
  const embargo = text.match(/EMBARGOED UNTIL 8:30 A\.M\. \(Eastern\) [A-Za-z]+, ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  const head = text.match(/In the week ending ([A-Za-z]+) (\d{1,2}), the advance figure for seasonally adjusted initial claims was ([\d,]*\d)/);
  if (!embargo || !head) return null;
  const day = isoOf(embargo[1], embargo[2], embargo[3]);
  if (!day) return null;
  const prev = text.match(/The previous week's level was (?:revised (?:up|down) by [\d,]*\d from [\d,]*\d to ([\d,]*\d)|unrevised at ([\d,]*\d))/);
  const previous = prev ? prev[1] ?? prev[2] : null;
  const year = Number(embargo[3]) - (MONTHS.indexOf(head[1].toLowerCase()) > MONTHS.indexOf(embargo[1].toLowerCase()) ? 1 : 0);
  const period = isoOf(head[1], head[2], String(year));
  if (!period) return null;
  return { day, actual: thousands(head[3]), previous: previous ? thousands(previous) : null, period };
}

/** The figure for the due event of that day, if the current release is that day's. */
export function claimsResult(dueIds: string[], release: ClaimsRelease | null, contexts: { id: string; reference_period?: string | null }[] = []): EventResult[] {
  if (!release) return [];
  const period = release.period || claimsWeekEnding(release.day);
  const id = contexts.find((e) => e.reference_period === period)?.id || dueIds.find((x) => x.endsWith(`:${release.day}`));
  const meta = { period, series: "initial-claims", unit: "thousand", adjustment: "SA", source_updated: isoUtc(wallToUtc(release.day, "08:30", NEW_YORK)) };
  const rows: EventResult[] = id ? [{ id, status: "released", actual: release.actual, previous: release.previous, summary: null, result_meta: meta }] : [];
  const prior = new Date(Date.parse(period) - 7 * 86_400_000).toISOString().slice(0, 10);
  const older = contexts.find((e) => e.reference_period === prior);
  if (older && release.previous !== null) rows.push({ id: older.id, status: "released", actual: release.previous, previous: null, summary: null, result_meta: { ...meta, period: prior } });
  return rows;
}
