import type { EventResult, ResultMeta } from "./types";
import { previousPeriod } from "./identity";
import { htmlTables, blsPeriod } from "./html-table";
import { plainText } from "./xml";
import { NEW_YORK, wallToUtc, nyDay } from "./time";

export const JOLTS_CODE = "us_jolts";
export const JOLTS_TITLE = "Job Openings and Labor Turnover Survey";
export const JOLTS_SERIES = "JTS000000000000000JOL";
export const JOLTS_SCHEDULE_URL = "https://www.bls.gov/schedule/news_release/jolts.htm";
export function joltsReleaseUrl(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00Z`).toISOString().slice(0,10) !== day) throw new Error("JOLTS: invalid release day");
  return `https://www.bls.gov/news.release/archives/jolts_${day.slice(5,7)}${day.slice(8,10)}${day.slice(0,4)}.htm`;
}
const clean = (s: string) => s.replace(/\(\s*(?:p|\d+)\s*\)/gi, "").replace(/\s+/g," ").trim();
const millions = (s: string | undefined): string | null => {
  const value = clean(s || "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const n = Number(value.replace(/,/g,""));
  return Number.isSafeInteger(n) ? `${(n / 1000).toFixed(3)}M` : null;
};
export interface JoltsRelease { day: string; period: string; published: string; actual: string | null; previous: string | null }

/** Only the dated publication's Total nonfarm openings LEVELS, never rates/hires or latest API. */
export function parseJoltsRelease(html: string, expectedDay: string): JoltsRelease {
  const header = plainText(html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || "");
  const date = /(\d{1,2}):(\d{2})\s*([ap])\.m\.\s*\(ET\)\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/i.exec(header);
  const ref = /JOB OPENINGS AND LABOR TURNOVER\s*[-–—]\s*(\w+)\s+(\d{4})/i.exec(header);
  const month = date && blsPeriod(date[4],date[6]);
  const day = month && date ? `${month}-${date[5].padStart(2,"0")}` : null;
  const period = ref && blsPeriod(ref[1],ref[2]);
  if (!date || !day || day !== expectedDay || !period || +date[1]<1 || +date[1]>12 || +date[2]>59) throw new Error("JOLTS: release date/reference period not verified");
  if (/\b(corrected release|reissued release|this release (?:has been|was) (?:corrected|reissued))\b/i.test(plainText(html))) throw new Error("JOLTS: corrected release requires review");
  const tables = htmlTables(html).filter(t => /^Table 1\./i.test(t.caption) && /Job openings levels and rates by industry and region, seasonally adjusted/i.test(t.caption));
  if (tables.length !== 1) throw new Error("JOLTS: seasonally adjusted Table 1 missing or ambiguous");
  const rows = tables[0].rows;
  const totals = rows.filter(r => clean(r[0] || "").toLowerCase() === "total");
  if (totals.length !== 1) throw new Error("JOLTS: Total nonfarm row missing or ambiguous");
  const headers = rows.slice(0,rows.indexOf(totals[0]));
  const columns = (wanted: string) => totals[0].flatMap((_,i) => {
    const path = Array.from(new Set(headers.map(r=>r[i] || ""))).join(" ");
    if (!/Levels \(in thousands\)/i.test(path) || /Rates|Change from/i.test(path)) return [];
    const periods = Array.from(path.matchAll(/([A-Za-z]+)\.?\s+(\d{4})/g), m=>blsPeriod(m[1],m[2])).filter(Boolean);
    return periods.length === 1 && periods[0] === wanted ? [{i,preliminary:/\(p\)/i.test(path)}] : [];
  });
  const current = columns(period), prior = columns(previousPeriod(period)!);
  if (current.length !== 1 || !current[0].preliminary || prior.length > 1) throw new Error("JOLTS: initial period/units/columns not verified");
  const hour = +date[1] % 12 + (date[3].toLowerCase()==="p" ? 12 : 0);
  return {day,period,published:new Date(wallToUtc(day,`${String(hour).padStart(2,"0")}:${date[2]}`,NEW_YORK)).toISOString(),
    actual:millions(totals[0][current[0].i]), previous:prior.length ? millions(totals[0][prior[0].i]) : null};
}
export function verifiedJoltsMeta(period: string | null | undefined, meta?: ResultMeta | null): boolean {
  if (!meta || meta.period !== period || meta.series !== JOLTS_SERIES || meta.unit !== "million" || meta.adjustment !== "SA" || meta.vintage !== "release" || meta.estimate_status !== "preliminary" || !meta.source_updated || !Number.isFinite(Date.parse(meta.source_updated))) return false;
  return meta.release_url === joltsReleaseUrl(nyDay(Date.parse(meta.source_updated)));
}
export function joltsResults(events: {id:string;code:string|null;reference_period?:string|null;release_stage?:string|null}[], release:JoltsRelease): EventResult[] {
  if (release.actual === null) return [];
  const url = joltsReleaseUrl(release.day);
  return events.filter(e=>e.code===JOLTS_CODE && e.reference_period===release.period && (!e.release_stage || e.release_stage==="regular")).map(e=>({
    id:e.id,status:"released",release_stage:"regular",actual:release.actual,previous:release.previous,summary:null,
    result_meta:{period:release.period,series:JOLTS_SERIES,unit:"million",adjustment:"SA",vintage:"release",estimate_status:"preliminary",source_updated:release.published,release_url:url,
      ...(release.previous===null ? {} : {previous_source:{period:previousPeriod(release.period)!,release_url:url,source_updated:release.published,basis:"reported-in-release"}})},
  }));
}
