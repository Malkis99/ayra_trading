import type { EventResult, ResultMeta } from "./types";
import { previousPeriod } from "./identity";
import { plainText } from "./xml";
import { NEW_YORK, wallToUtc } from "./time";
/** us_cpi is the existing headline m/m event. Do not rename its IDs or legacy history. */
export const CPI_METRICS = {
    us_cpi: { title: "Consumer Price Index", series: "CUSR0000SA0", adjustment: "SA", form: "mom", row: "All items" },
    us_cpi_yoy: { title: "Consumer Price Index (y/y)", series: "CUUR0000SA0", adjustment: "NSA", form: "yoy", row: "All items" },
    us_core_cpi: { title: "Core Consumer Price Index (m/m)", series: "CUSR0000SA0L1E", adjustment: "SA", form: "mom", row: "All items less food and energy" },
    us_core_cpi_yoy: { title: "Core Consumer Price Index (y/y)", series: "CUUR0000SA0L1E", adjustment: "NSA", form: "yoy", row: "All items less food and energy" },
} as const;
export type CpiCode = keyof typeof CPI_METRICS;
export const isCpiCode = (code: string | null): code is CpiCode => !!code && Object.prototype.hasOwnProperty.call(CPI_METRICS, code);
export function verifiedCpiMeta(code: CpiCode, reference: string | null | undefined, meta?: ResultMeta | null): boolean {
    const metric = CPI_METRICS[code];
    return !!meta && meta.vintage === "release" && meta.period === reference && meta.series === metric.series && meta.unit === `percent-${metric.form}` && meta.adjustment === metric.adjustment && !!meta.source_updated && Number.isFinite(Date.parse(meta.source_updated)) && /^https:\/\/www\.bls\.gov\/news\.release\/archives\/cpi_\d{8}\.htm$/.test(meta.release_url || "");
}
export function cpiReleaseUrl(releaseDay: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDay) || new Date(`${releaseDay}T00:00:00Z`).toISOString().slice(0, 10) !== releaseDay)
        throw new Error("CPI: invalid release day");
    return `https://www.bls.gov/news.release/archives/cpi_${releaseDay.slice(5, 7)}${releaseDay.slice(8, 10)}${releaseDay.slice(0, 4)}.htm`;
}
const MONTHS = "January February March April May June July August September October November December".split(" ");
function period(month: string, year: string): string | null {
    const m = MONTHS.findIndex(n => n.toLowerCase().startsWith(month.toLowerCase().replace(/\.$/, "")));
    return m < 0 ? null : `${year}-${String(m + 1).padStart(2, "0")}`;
}
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] || "";
const percent = (raw: string, signed: boolean): string | null => {
    const text = plainText(raw).replace(/\u2212/g, "-");
    if (!/^[+-]?\d+\.\d$/.test(text))
        return null;
    const n = Number(text);
    return `${n < 0 ? "−" : signed ? "+" : ""}${Math.abs(n).toFixed(1)}%`;
};
export interface CpiRelease {
    day: string;
    period: string;
    published: string;
    values: Record<CpiCode, {
        actual: string | null;
        previous: string | null;
    }>;
}
/** Only a dated official release's explicitly labelled Table 1. Never recompute from rounded/latest indexes. */
export function parseCpiRelease(html: string, expectedDay: string): CpiRelease {
    const pre = html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1];
    const header = plainText(pre || "");
    const date = header.match(/8:30\s*a\.m\.\s*\(ET\)\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/i);
    const ref = header.match(/CONSUMER PRICE INDEX\s*[-–]\s*(\w+)\s+(\d{4})/i);
    const month = date ? period(date[1], date[3]) : null;
    const day = month && date ? `${month}-${date[2].padStart(2, "0")}` : null;
    const reference = ref ? period(ref[1], ref[2]) : null;
    if (!day || day !== expectedDay || !reference)
        throw new Error("CPI: release date or reference period not verified");
    if (/\b(corrected release|this release (?:has been|was) corrected|reissued release)\b/i.test(header))
        throw new Error("CPI: corrected/reissued vintage requires review");
    const table = html.match(/<table\b[^>]*\bid=["']cpipress1["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
    if (!table)
        throw new Error("CPI: original Table 1 missing");
    const caption = plainText(table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "");
    const captionPeriod = caption.match(/category,\s*(\w+)\s+(\d{4})/i);
    if (!/All Urban Consumers.*U\.?\s*S\.?\s*city average/i.test(caption) || !captionPeriod || period(captionPeriod[1], captionPeriod[2]) !== reference)
        throw new Error("CPI: table population/period mismatch");
    const heads = new Map<string, string>();
    for (const m of table.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi))
        if (attr(m[1], "id"))
            heads.set(attr(m[1], "id"), plainText(m[2]));
    if (heads.get("cpipress1.h.1.6") !== "Unadjusted percent change" || heads.get("cpipress1.h.1.8") !== "Seasonally adjusted percent change")
        throw new Error("CPI: percent-change/adjustment headers changed");
    const ranges = (id: string) => Array.from((heads.get(id) || "").matchAll(/([A-Za-z]+)\.?\s+(\d{4})/g), m => period(m[1], m[2]));
    const prior = previousPeriod(reference)!;
    const annualStart = `${Number(reference.slice(0, 4)) - 1}${reference.slice(4)}`;
    if (JSON.stringify(ranges("cpipress1.h.2.6")) !== JSON.stringify([annualStart, reference]) || JSON.stringify(ranges("cpipress1.h.2.10")) !== JSON.stringify([prior, reference]) || JSON.stringify(ranges("cpipress1.h.2.9")) !== JSON.stringify([previousPeriod(prior), prior]))
        throw new Error("CPI: comparison periods not verified");
    const rows = new Map<string, string>();
    for (const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const th = m[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
        if (th) {
            const label = plainText(th[1]);
            if (label === "All items" || label === "All items less food and energy") {
                if (rows.has(label))
                    throw new Error("CPI: ambiguous metric row");
                rows.set(label, m[1]);
            }
        }
    }
    const read = (row: string, column: string, signed: boolean) => {
        const candidates = Array.from((rows.get(row) || "").matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)).filter(m => {
            const headers = attr(m[1], "headers").split(/\s+/);
            return headers.includes(column) && headers.includes(signed ? "cpipress1.h.1.8" : "cpipress1.h.1.6");
        });
        return candidates.length === 1 ? percent(candidates[0][2], signed) : null;
    };
    const values = Object.fromEntries(Object.entries(CPI_METRICS).map(([code, m]) => [code, { actual: read(m.row, m.form === "mom" ? "cpipress1.h.2.10" : "cpipress1.h.2.6", m.form === "mom"), previous: m.form === "mom" ? read(m.row, "cpipress1.h.2.9", true) : null }])) as CpiRelease["values"];
    // Optional, explicit year-over-year comparisons in the release prose. No inference from index levels.
    const currentMonth = MONTHS[Number(reference.slice(5)) - 1];
    const priorMonth = MONTHS[Number(prior.slice(5)) - 1];
    const annual = (code: "us_cpi_yoy" | "us_core_cpi_yoy", pattern: RegExp) => {
        const matches = Array.from(header.matchAll(pattern));
        if (matches.length !== 1)
            return;
        const match = matches[0];
        if (percent(match[1], false) === values[code].actual && match[2] === currentMonth && match[4] === priorMonth)
            values[code].previous = percent(match[3], false);
    };
    annual("us_cpi_yoy", /The all items index rose (\d+\.\d) percent for the 12 months ending (\w+), a (?:larger|smaller) increase than the (\d+\.\d)-percent increase reported for the 12 months ending in (\w+)\./g);
    // This sentence inherits the explicitly verified current annual period of the immediately preceding sentence.
    const core = new RegExp(`The all items index rose \\d+\\.\\d percent for the 12 months ending ${currentMonth}, a (?:larger|smaller) increase than the \\d+\\.\\d-percent increase reported for the 12 months ending in ${priorMonth}\\. The all items less food and energy index rose (\\d+\\.\\d) percent over the year, following a (\\d+\\.\\d)-percent increase over the 12 months ending ${priorMonth}\\.`, "g");
    const coreMatches = Array.from(header.matchAll(core));
    if (coreMatches.length === 1 && percent(coreMatches[0][1], false) === values.us_core_cpi_yoy.actual)
        values.us_core_cpi_yoy.previous = percent(coreMatches[0][2], false);
    return { day, period: reference, published: new Date(wallToUtc(day, "08:30", NEW_YORK)).toISOString(), values };
}
export function cpiResults(events: {
    id: string;
    code: string | null;
    reference_period?: string | null;
    release_stage?: string | null;
}[], release: CpiRelease): EventResult[] {
    return events.flatMap(e => {
        if (!isCpiCode(e.code) || e.reference_period !== release.period || (e.release_stage && e.release_stage !== "regular"))
            return [];
        const metric = CPI_METRICS[e.code], value = release.values[e.code];
        if (value.actual === null)
            return [];
        return [{ id: e.id, status: "released" as const, release_stage: "regular", actual: value.actual, previous: value.previous, summary: null,
                result_meta: { period: release.period, series: metric.series, unit: `percent-${metric.form}`, adjustment: metric.adjustment, source_updated: release.published, release_url: cpiReleaseUrl(release.day), vintage: "release" as const } }];
    });
}
