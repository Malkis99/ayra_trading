import { latestSchedules, scheduleIdentity } from "./identity";
import { isoUtc, wallToUtc } from "./time";
import type { EventRow, ScheduleMeta } from "./types";

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
