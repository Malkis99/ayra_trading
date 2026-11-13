import { latestSchedules, previousPeriod, scheduleIdentity } from "./identity";
import { isoUtc, wallToUtc } from "./time";
import type { EventResult, EventRow, ScheduleMeta } from "./types";

const ORIGIN = "https://www.ons.gov.uk";
const MONTHS = "January February March April May June July August September October November December".split(" ");
const DAY = 86_400_000;
const FAMILIES = [
  { label: "GDP monthly estimate", slug: "gdpmonthlyestimateuk", code: "gb_gdp_monthly", stage: "regular", importance: 3 },
  { label: "GDP first quarterly estimate", slug: "gdpfirstquarterlyestimateuk", code: "gb_gdp_first", stage: "preliminary", importance: 3 },
  { label: "GDP quarterly national accounts", slug: "gdpquarterlynationalaccountsuk", code: "gb_gdp_qna", stage: "revision", importance: 2 },
] as const;

export const ONS_LISTS = ["upcoming", "published", "cancelled"] as const;
export type OnsList = typeof ONS_LISTS[number];

export interface StoredOnsSchedule {
  id: string;
  source_uid: string;
  starts_at: string;
  status: "scheduled" | "released" | "cancelled";
  schedule_meta: ScheduleMeta | null;
}

export function onsCalendarUrl(list: OnsList, now: number): string {
  const url = new URL("/releasecalendar", ORIGIN);
  url.search = new URLSearchParams({ keywords: "GDP", "release-type": `type-${list}`, limit: "100", sort: "date-newest" }).toString();
  if (list === "published") {
    const recent = new Date(now - 14 * DAY);
    url.searchParams.set("after-day", String(recent.getUTCDate()));
    url.searchParams.set("after-month", String(recent.getUTCMonth() + 1));
    url.searchParams.set("after-year", String(recent.getUTCFullYear()));
  }
  return url.href;
}

function plain(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();
}

const BULLETINS = "/economy/grossdomesticproductgdp/bulletins";

function bulletin(row: EventRow) {
  const family = FAMILIES.find(item => item.code === row.code && item.stage === row.release_stage);
  const period = row.reference_period;
  if (!family || !period || row.source !== "ons" || row.country !== "gb") return null;
  const monthly = family.stage === "regular";
  const match = (monthly ? /^(\d{4})-(0[1-9]|1[0-2])$/ : /^(\d{4})-Q([1-4])$/).exec(period);
  if (!match) return null;
  const [, year, index] = match;
  const label = monthly ? MONTHS[+index - 1] : `${MONTHS[(+index - 1) * 3]} to ${MONTHS[+index * 3 - 1]}`;
  const slug = `${label.replaceAll(" ", "").toLowerCase()}${year}`;
  if (row.source_uid !== `/releases/${family.slug}${slug}`) return null;
  const directory = family.stage === "revision" ? "quarterlynationalaccounts" : family.slug;
  return { path: `${BULLETINS}/${directory}/${slug}`, title: `${family.label}, UK: ${label} ${year}`, monthly, period };
}

export function onsBulletinUrl(row: EventRow): string | null {
  const entry = bulletin(row);
  return entry ? ORIGIN + entry.path : null;
}

function percent(raw: string | undefined, direction?: string): string | null {
  if (raw === undefined || !/^-?\d{1,3}(?:\.\d)?$/.test(raw)) return null;
  const value = Number(raw) * (/^(fell|fallen|fall|declined|decreased)$/.test(direction ?? "") ? -1 : 1);
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function monthlyFigures(html: string, period: string) {
  const month = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
  const previous = month(previousPeriod(period)!);
  const current = month(period);
  const candidates = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), m => plain(m[1]));
  const pattern = new RegExp(`^Monthly (?:real )?GDP (?:is estimated to have )?(?:(grew|grown|fell|fallen|declined|increased|decreased) by (\\d{1,3}(?:\\.\\d)?)%|(?:showed|shown) no growth) in ${current}\\b`);
  const prior = new RegExp(`^(?:, )?(?:after|following) (?:(?:showing )?no growth|(?:a )?(growth|fall|increase|decrease) of (\\d{1,3}(?:\\.\\d)?)%) in ${previous}\\b`);
  const found = candidates.flatMap(text => {
    const match = pattern.exec(text);
    if (!match) return [];
    const before = prior.exec(text.slice(match[0].length));
    return [{ actual: match[2] ? percent(match[2], match[1]) : "0.0%", previous: before ? before[2] ? percent(before[2], before[1] === "decrease" ? "decreased" : before[1]) : "0.0%" : null }];
  });
  const actuals = new Set(found.map(x => x.actual));
  const previousValues = new Set(found.flatMap(x => x.previous ? [x.previous] : []));
  if (actuals.size > 1 || previousValues.size > 1) throw new Error("ONS GDP: conflicting monthly figures");
  return { actual: found[0]?.actual ?? null, previous: [...previousValues][0] ?? null };
}

function quarterlyFigures(html: string, period: string) {
  const figures = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)].map(m => m[1]).filter(section =>
    /<caption\b[^>]*>\s*Table 1:\s*Headline national accounts indicators for the UK/i.test(section)
      && /Percentage change on previous period/i.test(plain(section)));
  if (figures.length !== 1) return { actual: null, previous: null };
  const rows = [...figures[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
    [...m[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(c => plain(c[2])));
  const column = rows[0]?.indexOf("GDP (Chained volume measures)") ?? -1;
  if (column < 1 || !rows.some(row => row[0] === "Seasonally adjusted")) return { actual: null, previous: null };
  const value = (p: string) => {
    const [year, quarter] = p.split("-");
    const matches = rows.filter(row => row[0] === `${quarter} ${year}`);
    return matches.length === 1 && matches[0].length === rows[0].length ? percent(matches[0][column]) : null;
  };
  return { actual: value(period), previous: value(previousPeriod(period)!) };
}

export function onsGdpResult(html: string, row: EventRow): EventResult | null {
  const expected = bulletin(row);
  if (!expected) throw new Error("ONS GDP: unverified bulletin identity");
  const canonical = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html)?.[1];
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const date = /\["releaseDate"\]\s*=\s*"(\d{4}\/\d{2}\/\d{2})"/.exec(html)?.[1];
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.starts_at));
  if ((canonical !== expected.path && canonical !== ORIGIN + expected.path) || !title || plain(title) !== expected.title || date?.replaceAll("/", "-") !== day) {
    throw new Error("ONS GDP: bulletin period, stage or date mismatch");
  }
  if (/class="[^"]*alert-release-banner__correction|<h[2-4]\b[^>]*>\s*Corrections?\s*<\/h/i.test(html)) {
    throw new Error("ONS GDP: correction requires provenance review");
  }
  if (expected.monthly && !/The monthly estimates of GDP are seasonally adjusted\b/i.test(plain(html))) {
    throw new Error("ONS GDP: monthly seasonal adjustment unverified");
  }
  const { actual, previous } = expected.monthly ? monthlyFigures(html, expected.period) : quarterlyFigures(html, expected.period);
  if (actual === null) return null;
  return {
    id: row.id, status: "released", actual, previous, summary: null, release_stage: row.release_stage,
    result_meta: {
      period: expected.period, series: expected.monthly ? "ECYX" : "IHYQ", unit: expected.monthly ? "percent-mom" : "percent-qoq",
      adjustment: "SA", source_updated: row.starts_at, release_url: ORIGIN + expected.path, vintage: "release",
    },
  };
}

function londonTime(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const parsed = new Date(day);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day) return null;
  return isoUtc(wallToUtc(day, time, "Europe/London"));
}

function releaseTime(text: string): string | null {
  const parts = /^(\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(text);
  if (!parts) return null;
  const [, day, month, year, hour, minute, meridiem] = parts;
  const monthNumber = MONTHS.indexOf(month) + 1;
  if (!monthNumber || +hour < 1 || +hour > 12) return null;
  const h = +hour % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  return londonTime(`${year}-${String(monthNumber).padStart(2, "0")}-${day.padStart(2, "0")}`, `${String(h).padStart(2, "0")}:${minute}`);
}

export function onsSchedules(html: string, list: OnsList, now: number): EventRow[] {
  const page = /class="ons-pagination__position[^"]*"[^>]*>\s*Page 1 of (\d+)/i.exec(html);
  if (!/<h1[^>]*>\s*Release calendar\s*<\/h1>/i.test(html) || page?.[1] !== "1") {
    throw new Error("ONS GDP: incomplete or unexpected calendar page");
  }
  const expected = { upcoming: "Confirmed", published: "Published", cancelled: "Cancelled" }[list];
  const rows: EventRow[] = [];
  for (const card of html.matchAll(/<li\b[^>]*>\s*<a\b([^>]*data-gtm-release-date[^>]*)>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/gi)) {
    const title = plain(card[2]);
    const family = FAMILIES.find(item => title.startsWith(`${item.label}, UK: `));
    if (!family || /\s(?:time\s*series)$/i.test(title) || !new RegExp(`<span>\\s*${expected}\\s*<\\/span>`, "i").test(card[3])) continue;
    const reference = title.slice(family.label.length + 6);
    const periodMatch = /^(?:(\w+) to )?(\w+) (\d{4})$/.exec(reference);
    const href = /\bhref="(\/releases\/[a-z0-9-]+)"/i.exec(card[1])?.[1];
    const date = /\bdata-gtm-release-date="(\d{4})(\d{2})(\d{2})"/i.exec(card[1]);
    const time = /\bdata-gtm-release-time="([^"]+)"/i.exec(card[1])?.[1];
    const visibleDate = /Release date:\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(card[3]);
    const instant = date && time ? londonTime(`${date[1]}-${date[2]}-${date[3]}`, time) : null;
    if (!periodMatch || !href?.startsWith(`/releases/${family.slug}`) || !instant || !visibleDate || instant !== releaseTime(plain(visibleDate[1]))) {
      throw new Error("ONS GDP: unverified release identity or publication time");
    }
    const [, firstMonth, finalMonth, year] = periodMatch;
    const month = MONTHS.indexOf(finalMonth) + 1;
    const isMonthly = family.stage === "regular";
    if (!month || (isMonthly ? !!firstMonth : month % 3 !== 0 || MONTHS[month - 3] !== firstMonth)) {
      throw new Error("ONS GDP: invalid reference period");
    }
    if (Date.parse(instant) < now - (list === "published" ? 14 : 90) * DAY) continue;
    const period = isMonthly ? `${year}-${String(month).padStart(2, "0")}` : `${year}-Q${month / 3}`;
    const row = scheduleIdentity({
      id: `ons:${family.code}:${period.toLowerCase()}`, source: "ons", country: "gb", kind: "release",
      code: family.code, title: family.label, importance: family.importance, starts_at: instant, time_tbd: false,
      url: ORIGIN + href,
    }, period, family.stage, null, { sequence: 0, cancelled: list === "cancelled" });
    rows.push({ ...row, source_uid: href });
  }
  return latestSchedules(rows);
}

/** Version evidence is the publisher's change history on the same release page. */
export function onsMoveSequence(html: string, row: EventRow, prior: StoredOnsSchedule): number | null {
  const title = /"contentTitle":\s*"([^"]+)"/i.exec(html)?.[1];
  const slug = title?.toLowerCase().replace(/[^a-z0-9]/g, "");
  const current = /Release date:\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  const history = /<section\b[^>]*id="changestothisreleasedate"[^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1];
  if (!slug || `/releases/${slug}` !== row.source_uid || !current || releaseTime(plain(current[1])) !== row.starts_at || !history) return null;
  const dates = Array.from(history.matchAll(/<h3\b[^>]*>\s*Previous date\s*<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi), match => releaseTime(plain(match[1])));
  const version = dates.length * 2;
  return dates.every(Boolean) && dates.includes(isoUtc(Date.parse(prior.starts_at))) && version > (prior.schedule_meta?.sequence ?? 0)
    ? version : null;
}
