import type { EventResult, ResultMeta } from "./types";
import { previousPeriod } from "./identity";
import { plainText } from "./xml";
import { htmlTables, blsMonth, blsPeriod } from "./html-table";
import { NEW_YORK, wallToUtc } from "./time";

export const PPI_METRICS = {
  us_ppi: { title: "Producer Price Index", item: "4", row: "Final demand", adjustment: "SA", form: "mom" },
  us_ppi_yoy: { title: "Producer Price Index (y/y)", item: "4", row: "Final demand", adjustment: "NSA", form: "yoy" },
  us_core_ppi: { title: "Core Producer Price Index (m/m)", item: "49104", row: "Final demand less foods and energy", adjustment: "SA", form: "mom" },
  us_core_ppi_yoy: { title: "Core Producer Price Index (y/y)", item: "49104", row: "Final demand less foods and energy", adjustment: "NSA", form: "yoy" },
} as const;
export type PpiCode = keyof typeof PPI_METRICS;
export const isPpiCode = (code: string | null): code is PpiCode => !!code && Object.prototype.hasOwnProperty.call(PPI_METRICS, code);
export const PPI_SCHEDULE_URL = "https://www.bls.gov/schedule/news_release/ppi.htm";
export function ppiReleaseUrl(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00Z`).toISOString().slice(0,10) !== day) throw new Error("PPI: invalid release day");
  return `https://www.bls.gov/news.release/archives/ppi_${day.slice(5,7)}${day.slice(8,10)}${day.slice(0,4)}.htm`;
}
const clean = (s: string) => s.replace(/\(\s*(?:\d+|p)\s*\)/gi, "").replace(/\s+/g," ").trim();
const pct = (s: string | undefined, signed: boolean): string | null => {
  const value = clean(s || "").replace(/−/g,"-");
  if (!/^[+-]?\d+\.\d$/.test(value)) return null;
  const n = Number(value);
  return `${n < 0 ? "−" : signed ? "+" : ""}${Math.abs(n).toFixed(1)}%`;
};
export interface PpiRelease {
  day: string; period: string; published: string;
  values: Record<PpiCode, { actual: string | null; previous: string | null }>;
}
/** Published percentages, not ratios of rounded/latest index levels. */
export function parsePpiRelease(html: string, expectedDay: string): PpiRelease {
  const header = plainText(html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || "");
  const date = /8:30\s*a\.m\.\s*\(ET\)\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/i.exec(header);
  const ref = /PRODUCER PRICE INDEXES\s*[-–]\s*(\w+)\s+(\d{4})/i.exec(header);
  const month = date && blsPeriod(date[1],date[3]);
  const day = month && date ? `${month}-${date[2].padStart(2,"0")}` : null;
  const period = ref && blsPeriod(ref[1],ref[2]);
  if (!day || day !== expectedDay || !period) throw new Error("PPI: release date/reference period not verified");
  if (/\b(corrected release|reissued release|this release (?:has been|was) corrected)\b/i.test(header)) throw new Error("PPI: corrected release requires review");
  const tables = htmlTables(html);
  const candidates = tables.filter(t => /^Table 1\./i.test(t.caption) && /percentage changes and weights for Final Demand-Intermediate Demand/i.test(t.caption));
  if (candidates.length !== 1) throw new Error("PPI: original Table 1 missing or ambiguous");
  const table = candidates[0];
  const captionPeriod = /\[(\w+) (\d{4})\]/.exec(table.caption);
  if (!captionPeriod || blsPeriod(captionPeriod[1],captionPeriod[2]) !== period) throw new Error("PPI: table period mismatch");
  const first = table.rows.findIndex(r => clean(r[0] || "").toLowerCase() === "final demand" && r[1] === "FD" && r[2] === "4");
  if (first < 1) throw new Error("PPI: final demand grouping not verified");
  const headings = table.rows.slice(0,first).filter(r => r.some(c => /percent change|\bto\b/i.test(c)));
  const paths = Array.from({length: table.rows[first].length}, (_, i) => Array.from(new Set(headings.map(r => clean(r[i] || "")))).join(" "));
  const annual = paths.flatMap((h,i) => /Unadjusted 12-month percent change/i.test(h) ? [i] : []);
  const monthly = paths.flatMap((h,i) => /Seasonally adjusted 1-month percent change/i.test(h) ? [i] : []);
  if (annual.length !== 1 || monthly.length < 2) throw new Error("PPI: adjustment/units headers not verified");
  const a = paths[annual[0]].match(/(\w+)\.? (\d{4}) to (\w+)\.? (\d{4})/);
  if (!a || blsPeriod(a[1],a[2]) !== `${Number(period.slice(0,4))-1}${period.slice(4)}` || blsPeriod(a[3],a[4]) !== period) throw new Error("PPI: annual comparison period mismatch");
  const previous = previousPeriod(period)!;
  const before = previousPeriod(previous)!;
  const column = (start: string, end: string) => monthly.filter(i => {
    const pair = paths[i].match(/([A-Za-z]+)\.? to ([A-Za-z]+)\.?\s*$/);
    return pair && blsMonth(pair[1]) === Number(start.slice(5)) && blsMonth(pair[2]) === Number(end.slice(5));
  });
  const currentCols = column(previous,period), priorCols = column(before,previous);
  if (currentCols.length !== 1 || priorCols.length !== 1) throw new Error("PPI: monthly comparison periods not verified");
  if (![annual[0],currentCols[0]].every(i => headings.some(r => /\(p\)/i.test(r[i] || "")))) throw new Error("PPI: initial preliminary estimate not confirmed");
  const values = Object.fromEntries(Object.entries(PPI_METRICS).map(([code,m]) => {
    const rows = table.rows.filter(r => clean(r[0] || "").toLowerCase() === m.row.toLowerCase() && r[1] === "FD" && r[2] === m.item);
    if (rows.length !== 1) throw new Error(`PPI: ambiguous/missing ${m.item} grouping`);
    return [code, { actual: pct(rows[0][m.form === "mom" ? currentCols[0] : annual[0]],m.form === "mom"), previous: m.form === "mom" ? pct(rows[0][priorCols[0]],true) : null }];
  })) as PpiRelease["values"];
  const history = tables.filter(t => /^Table A\./i.test(t.caption));
  if (history.length === 1) {
    const rows = history[0].rows;
    const index = rows.findIndex(r => r.some(c => /Change in final demand from 12 months ago.*unadj/i.test(clean(c))));
    const cols = index < 0 ? [] : rows[index].flatMap((c,i) => /Change in final demand from 12 months ago.*unadj/i.test(clean(c)) ? [i] : []);
    if (cols.length === 1) {
      const data = new Map<string,string | null>(); let year: string | null = null;
      for (const row of rows.slice(index+1)) {
        const label = clean(row[0] || "");
        if (/^\d{4}$/.test(label)) year = label;
        else if (year && blsMonth(label)) data.set(blsPeriod(label,year)!, pct(row[cols[0]],false));
      }
      if (data.get(period) === values.us_ppi_yoy.actual) values.us_ppi_yoy.previous = data.get(previous) ?? null;
    }
  }
  return { day, period, published: new Date(wallToUtc(day,"08:30",NEW_YORK)).toISOString(), values };
}
export function verifiedPpiMeta(code: PpiCode, period: string | null | undefined, meta?: ResultMeta | null): boolean {
  const m = PPI_METRICS[code];
  return !!meta && meta.period === period && meta.series === `FD${m.item}` && meta.unit === `percent-${m.form}` && meta.adjustment === m.adjustment && meta.vintage === "release" && meta.estimate_status === "preliminary" && /^https:\/\/www\.bls\.gov\/news\.release\/archives\/ppi_\d{8}\.htm$/.test(meta.release_url || "") && !!meta.source_updated && Number.isFinite(Date.parse(meta.source_updated));
}
export function ppiResults(events: {id: string; code: string | null; reference_period?: string | null; release_stage?: string | null}[], release: PpiRelease): EventResult[] {
  return events.flatMap(e => {
    if (!isPpiCode(e.code) || e.reference_period !== release.period || (e.release_stage && e.release_stage !== "regular")) return [];
    const m = PPI_METRICS[e.code], value = release.values[e.code];
    if (value.actual === null) return [];
    const url = ppiReleaseUrl(release.day);
    return [{id: e.id, status: "released" as const, release_stage: "regular", actual: value.actual, previous: value.previous, summary: null,
      result_meta: {period: release.period, series: `FD${m.item}`, unit: `percent-${m.form}`, adjustment: m.adjustment, source_updated: release.published, release_url: url, vintage: "release" as const, estimate_status: "preliminary" as const,
        ...(value.previous === null ? {} : {previous_source: {period: previousPeriod(release.period)!, release_url: url, source_updated: release.published, basis: "reported-in-release" as const}})}}];
  });
}
