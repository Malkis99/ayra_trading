import type { EventRow } from "./types";
import { FRANKFURT, NEW_YORK, isoUtc, wallToUtc } from "./time";
import { listedUsEvents } from "./schedules-us";
import { scheduleIdentity } from "./identity";
import { applyListedCorrections } from "./listed-corrections";
import { CPI_METRICS, isCpiCode } from "./cpi";

/**
 * Schedules that have no machine-readable feed we may use, taken from the official pages (read 2026-11-03).
 * Update once a year (a test fails when the next year is missing); each list names its page.
 *
 * - FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm — the statement at 2:00 p.m., the press
 *   conference at 2:30 p.m. (Fed's monthly calendar, e.g. /newsevents/2026-december.htm), the minutes three weeks
 *   after the decision at 2:00 p.m. Eastern Time.
 * - ECB: https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html — the decision at 14:15 CET (the ECB's
 *   own feed publishes «Monetary policy decisions» at 14:15), the press conference at 14:45 CET.
 * - BLS: https://www.bls.gov/schedule/2026/home.htm and /2027/home.htm («All times on calendar are Eastern Time»).
 *   BLS refuses automated downloads of its .ics without the owner's contact, so the main releases are listed here.
 *   JOLTS 2027 is not scheduled by BLS yet.
 */

/** Decision days (the second day of the meeting). */
export const FOMC_DECISIONS = [
  "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
] as const;
/** Meetings with a Summary of Economic Projections (marked * by the Fed). */
const FOMC_SEP = new Set(["2026-12-09", "2027-03-17", "2027-06-09", "2027-09-15", "2027-12-08"]);

export const ECB_DECISIONS = [
  "2026-12-17",
  "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16",
] as const;

/** BLS releases: code, BLS name, release day → the reference period it covers. */
export const BLS_RELEASES: Record<"us_nfp" | "us_cpi" | "us_ppi" | "us_jolts" | "us_eci", { name: string; time: string; importance: 1 | 2 | 3; dates: Record<string, string> }> = {
  us_nfp: {
    name: "Employment Situation",
    time: "08:30",
    importance: 3,
    dates: {
      "2026-11-06": "2026-10", "2026-12-04": "2026-11", "2027-01-08": "2026-12", "2027-02-05": "2027-01", "2027-03-05": "2027-02",
      "2027-04-02": "2027-03", "2027-05-07": "2027-04", "2027-06-04": "2027-05", "2027-07-02": "2027-06", "2027-08-06": "2027-07",
      "2027-09-03": "2027-08", "2027-10-08": "2027-09", "2027-11-05": "2027-10", "2027-12-03": "2027-11",
    },
  },
  us_cpi: {
    name: "Consumer Price Index",
    time: "08:30",
    importance: 3,
    dates: {
      "2026-11-10": "2026-10", "2026-12-10": "2026-11", "2027-01-13": "2026-12", "2027-02-11": "2027-01", "2027-03-10": "2027-02",
      "2027-04-13": "2027-03", "2027-05-12": "2027-04", "2027-06-10": "2027-05", "2027-07-14": "2027-06", "2027-08-11": "2027-07",
      "2027-09-14": "2027-08", "2027-10-14": "2027-09", "2027-11-10": "2027-10", "2027-12-10": "2027-11",
    },
  },
  us_ppi: {
    name: "Producer Price Index",
    time: "08:30",
    importance: 2,
    dates: {
      "2026-11-13": "2026-10", "2026-12-15": "2026-11", "2027-01-14": "2026-12", "2027-02-12": "2027-01", "2027-03-12": "2027-02",
      "2027-04-14": "2027-03", "2027-05-13": "2027-04", "2027-06-11": "2027-05", "2027-07-15": "2027-06", "2027-08-10": "2027-07",
      "2027-09-10": "2027-08", "2027-10-15": "2027-09", "2027-11-12": "2027-10", "2027-12-15": "2027-11",
    },
  },
  us_jolts: {
    name: "Job Openings and Labor Turnover Survey",
    time: "10:00",
    importance: 2,
    dates: { "2026-11-03": "2026-09", "2026-12-01": "2026-10" },
  },
  us_eci: {
    name: "Employment Cost Index",
    time: "08:30",
    importance: 2,
    dates: { "2027-01-29": "2026-Q4", "2027-04-30": "2027-Q1", "2027-07-30": "2027-Q2", "2027-10-29": "2027-Q3" },
  },
};

const FOMC_PAGE = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const ECB_PAGE = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html";
const BLS_PAGE = "https://www.bls.gov/schedule/news_release/";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Every listed event as calendar rows: FOMC, ECB, BLS, and EIA, Census, DOL (schedules-us.ts). */
export function listedEvents(): EventRow[] {
  const rows: EventRow[] = [];
  for (const day of FOMC_DECISIONS) {
    const sep = FOMC_SEP.has(day) ? " and Summary of Economic Projections" : "";
    rows.push(
      { id: `fed:fomc:${day}:decision`, source: "fed", kind: "decision", code: "fomc_decision", country: "us", title: `FOMC statement${sep}`, importance: 3, starts_at: isoUtc(wallToUtc(day, "14:00", NEW_YORK)), time_tbd: false, url: FOMC_PAGE },
      { id: `fed:fomc:${day}:press`, source: "fed", kind: "press_conference", code: "fomc_press", country: "us", title: "FOMC press conference", importance: 3, starts_at: isoUtc(wallToUtc(day, "14:30", NEW_YORK)), time_tbd: false, url: FOMC_PAGE },
      { id: `fed:fomc:${day}:minutes`, source: "fed", kind: "minutes", code: "fomc_minutes", country: "us", title: "Minutes of the FOMC meeting", importance: 2, starts_at: isoUtc(wallToUtc(addDays(day, 21), "14:00", NEW_YORK)), time_tbd: false, url: FOMC_PAGE }
    );
  }
  for (const day of ECB_DECISIONS) {
    rows.push(
      { id: `ecb:mpm:${day}:decision`, source: "ecb", kind: "decision", code: "ecb_decision", country: "eu", title: "ECB monetary policy decisions", importance: 3, starts_at: isoUtc(wallToUtc(day, "14:15", FRANKFURT)), time_tbd: false, url: ECB_PAGE },
      { id: `ecb:mpm:${day}:press`, source: "ecb", kind: "press_conference", code: "ecb_press", country: "eu", title: "ECB press conference", importance: 3, starts_at: isoUtc(wallToUtc(day, "14:45", FRANKFURT)), time_tbd: false, url: ECB_PAGE }
    );
  }
  for (const [code, r] of Object.entries(BLS_RELEASES)) {
    for (const day of Object.keys(r.dates)) {
      const metrics = code === "us_cpi" ? Object.entries(CPI_METRICS).map(([code, m]) => ({ code, name: m.title })) : [{ code, name: r.name }];
      for (const metric of metrics) rows.push({ id: `bls:${metric.code}:${day}`, source: "bls", kind: "release", code: metric.code, country: "us", title: metric.name, importance: r.importance, starts_at: isoUtc(wallToUtc(day, r.time, NEW_YORK)), time_tbd: false, url: BLS_PAGE });
    }
  }
  rows.push(...listedUsEvents());
  return applyListedCorrections(rows.map((r) => r.identity_key ? r : scheduleIdentity(r,
    r.source === "bls" ? BLS_RELEASES[isCpiCode(r.code) ? "us_cpi" : r.code as keyof typeof BLS_RELEASES]?.dates[r.id.split(":")[2]] || null : r.id.split(":")[2],
    r.source === "bls" ? "regular" : r.kind, null, { sequence: 0 })));
}

/** The last listed FOMC / ECB decision (a test warns when it is less than two months ahead). */
export const lastListedDecision = () => [...FOMC_DECISIONS, ...ECB_DECISIONS].sort().at(-1)!;
