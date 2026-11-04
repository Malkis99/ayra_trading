import type { EventRow, Importance } from "./types";
import { NEW_YORK, isoUtc, wallToUtc } from "./time";

/**
 * More US schedules (docs/market-feeds-plan.md, section 9, PR 1): EIA, Census, DOL. None of them offers a feed of
 * its release dates we may use, so the dates are listed here from the official pages (read 2026-11-04). Update once
 * a year (a test fails when the list runs out); each list names its page. All times are Eastern Time.
 *
 * - EIA, Weekly Petroleum Status Report: https://www.eia.gov/petroleum/supply/weekly/schedule.php — «10:30 a.m.
 *   eastern time on Wednesday» with listed exceptions. 2027 exceptions are not published yet: the weeks with a
 *   federal holiday on Monday–Wednesday (EIA then moves the report, as every such week of 2026) are left out until
 *   EIA lists them.
 * - EIA, Weekly Natural Gas Storage Report: https://ir.eia.gov/ngs/schedule.html — «10:30 a.m. eastern time on
 *   Thursdays» with listed exceptions; 2027 dates from OMB's Schedule of Release Dates for Principal Federal Economic
 *   Indicators for 2027 (https://www.whitehouse.gov/wp-content/uploads/2026/10/FY2027-PFEI.pdf) and its holiday rule
 *   (a Thursday holiday moves the report to Wednesday at noon).
 * - Census: the Economic Indicator Calendar (https://www.census.gov/economic-indicators/calendar-listview.html).
 *   census.gov refuses automated reads, so it was read from the Web Archive's copies of that page (2026-08-19 for
 *   2026, 2026-10-19 for 2027); the dates match OMB's schedules for 2026 and 2027.
 * - DOL, Unemployment Insurance Weekly Claims: every Thursday at 8:30 a.m. (https://www.dol.gov/ui/data.pdf, «EMBARGOED
 *   UNTIL 8:30 A.M. (Eastern) Thursday»); a Thursday federal holiday moves it to Wednesday, as DOL does. DOL publishes
 *   no list of dates, so this rule makes them.
 */

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Every date from `from` to `to` (inclusive) on the same weekday as `from`. */
const weekly = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) out.push(d);
  return out;
};

/** EIA crude: the weeks of 2027 with a federal holiday on Monday–Wednesday (moved by EIA; dates not out yet). */
const EIA_CRUDE_2027_UNKNOWN = new Set(["2027-01-20", "2027-02-17", "2027-06-02", "2027-07-07", "2027-09-08", "2027-10-13"]);
/** EIA crude: the published exceptions (a regular Wednesday → its day and time). */
const EIA_CRUDE_MOVED: Record<string, [string, string]> = { "2026-11-11": ["2026-11-12", "12:00"] };

/** Release day and ET time of each Weekly Petroleum Status Report. */
export function eiaCrudeDates(): [string, string][] {
  return weekly("2026-11-04", "2027-12-29")
    .filter((d) => !EIA_CRUDE_2027_UNKNOWN.has(d))
    .map((d) => EIA_CRUDE_MOVED[d] ?? [d, "10:30"]);
}

/** EIA gas storage: 2026 from EIA's schedule, 2027 from OMB's (regular Thursdays and the moved ones). */
const EIA_GAS_MOVED: Record<string, [string, string]> = {
  "2026-11-12": ["2026-11-13", "10:30"], // Veterans Day
  "2026-11-26": ["2026-11-25", "12:00"], // Thanksgiving Day
  "2027-11-11": ["2027-11-10", "12:00"], // Veterans Day
  "2027-11-25": ["2027-11-24", "12:00"], // Thanksgiving Day
};
export function eiaGasDates(): [string, string][] {
  return weekly("2026-11-05", "2027-12-30").map((d) => EIA_GAS_MOVED[d] ?? [d, "10:30"]);
}

/** DOL weekly claims: Thursday, or Wednesday when Thursday is a federal holiday. */
const DOL_MOVED: Record<string, string> = {
  "2026-11-26": "2026-11-25", // Thanksgiving Day
  "2027-11-11": "2027-11-10", // Veterans Day
  "2027-11-25": "2027-11-24", // Thanksgiving Day
};
export function dolClaimsDates(): string[] {
  return weekly("2026-11-05", "2027-12-30").map((d) => DOL_MOVED[d] ?? d);
}

/** Census releases: code, Census name, ET time, release day → the month it covers. */
export const CENSUS_RELEASES: Record<"us_retail_sales" | "us_durable_goods" | "us_housing_starts" | "us_new_home_sales", { name: string; time: string; importance: Importance; dates: Record<string, string> }> = {
  us_retail_sales: {
    name: "Advance Monthly Sales for Retail and Food Services",
    time: "08:30",
    importance: 3,
    dates: {
      "2026-11-17": "2026-10", "2026-12-16": "2026-11", "2027-01-15": "2026-12", "2027-02-17": "2027-01", "2027-03-16": "2027-02",
      "2027-04-16": "2027-03", "2027-05-14": "2027-04", "2027-06-16": "2027-05", "2027-07-16": "2027-06", "2027-08-16": "2027-07",
      "2027-09-16": "2027-08", "2027-10-15": "2027-09", "2027-11-16": "2027-10", "2027-12-15": "2027-11",
    },
  },
  us_durable_goods: {
    name: "Advance Report on Durable Goods",
    time: "08:30",
    importance: 2,
    dates: {
      "2026-11-25": "2026-10", "2026-12-23": "2026-11", "2027-01-27": "2026-12", "2027-02-25": "2027-01", "2027-03-25": "2027-02",
      "2027-04-27": "2027-03", "2027-05-27": "2027-04", "2027-06-25": "2027-05", "2027-07-28": "2027-06", "2027-08-25": "2027-07",
      "2027-09-27": "2027-08", "2027-10-27": "2027-09", "2027-11-24": "2027-10", "2027-12-22": "2027-11",
    },
  },
  us_housing_starts: {
    name: "New Residential Construction",
    time: "08:30",
    importance: 2,
    dates: {
      "2026-11-18": "2026-10", "2026-12-17": "2026-11", "2027-01-20": "2026-12", "2027-02-18": "2027-01", "2027-03-17": "2027-02",
      "2027-04-20": "2027-03", "2027-05-18": "2027-04", "2027-06-17": "2027-05", "2027-07-20": "2027-06", "2027-08-17": "2027-07",
      "2027-09-21": "2027-08", "2027-10-19": "2027-09", "2027-11-17": "2027-10", "2027-12-16": "2027-11",
    },
  },
  us_new_home_sales: {
    name: "New Residential Sales",
    time: "10:00",
    importance: 2,
    dates: {
      "2026-11-25": "2026-10", "2026-12-23": "2026-11", "2027-01-27": "2026-12", "2027-02-24": "2027-01", "2027-03-23": "2027-02",
      "2027-04-23": "2027-03", "2027-05-25": "2027-04", "2027-06-24": "2027-05", "2027-07-26": "2027-06", "2027-08-24": "2027-07",
      "2027-09-24": "2027-08", "2027-10-26": "2027-09", "2027-11-24": "2027-10", "2027-12-22": "2027-11",
    },
  },
};

export const EIA_CRUDE_PAGE = "https://www.eia.gov/petroleum/supply/weekly/";
export const EIA_GAS_PAGE = "https://ir.eia.gov/ngs/ngs.html";
export const CENSUS_PAGE = "https://www.census.gov/economic-indicators/";
export const DOL_PAGE = "https://www.dol.gov/ui/data.pdf";

const at = (day: string, time: string) => isoUtc(wallToUtc(day, time, NEW_YORK));

/** Every listed EIA, Census and DOL event as calendar rows. */
export function listedUsEvents(): EventRow[] {
  const rows: EventRow[] = [];
  for (const [day, time] of eiaCrudeDates()) {
    rows.push({ id: `eia:us_eia_crude:${day}`, source: "eia", kind: "release", code: "us_eia_crude", country: "us", title: "Weekly Petroleum Status Report", importance: 3, starts_at: at(day, time), time_tbd: false, url: EIA_CRUDE_PAGE });
  }
  for (const [day, time] of eiaGasDates()) {
    rows.push({ id: `eia:us_eia_gas:${day}`, source: "eia", kind: "release", code: "us_eia_gas", country: "us", title: "Weekly Natural Gas Storage Report", importance: 2, starts_at: at(day, time), time_tbd: false, url: EIA_GAS_PAGE });
  }
  for (const [code, r] of Object.entries(CENSUS_RELEASES)) {
    for (const day of Object.keys(r.dates)) {
      rows.push({ id: `census:${code}:${day}`, source: "census", kind: "release", code, country: "us", title: r.name, importance: r.importance, starts_at: at(day, r.time), time_tbd: false, url: CENSUS_PAGE });
    }
  }
  for (const day of dolClaimsDates()) {
    rows.push({ id: `dol:us_jobless_claims:${day}`, source: "dol", kind: "release", code: "us_jobless_claims", country: "us", title: "Unemployment Insurance Weekly Claims", importance: 3, starts_at: at(day, "08:30"), time_tbd: false, url: DOL_PAGE });
  }
  return rows;
}

/** The Friday that ends the week a weekly report covers: the last Friday before the release day. */
export function weekEnding(releaseDay: string): string {
  let d = addDays(releaseDay, -1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 5) d = addDays(d, -1);
  return d;
}

/** DOL's claims cover the week ending the Saturday before the release. */
export function claimsWeekEnding(releaseDay: string): string {
  let d = addDays(releaseDay, -1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = addDays(d, -1);
  return d;
}
