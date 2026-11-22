import { blocks, plainText, text } from "../feeds/xml";
import { verifyBeaRelease, type PceObservation } from "./bea-pce";
import { fundamentalDefinitions, previousMonth, type FundamentalObservation } from "./fundamentals-data";

const months = "January February March April May June July August September October November December".split(" ");
function numeric(raw: string) {
  const value = raw.trim().replace(/,/g, "").replace("−", "-");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error("invalid_number");
  return Number(value);
}
function monthPeriod(month: string, year: number) {
  const index = months.findIndex(value => value.toLowerCase() === month.toLowerCase());
  if (index < 0) throw new Error("unverified_period");
  return year + "-" + String(index + 1).padStart(2, "0");
}
export function htmlRows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plainText(cell[1])));
}
function onlyRow(rows: string[][], title: string) {
  const found = rows.filter(row => row[0] === title);
  if (found.length !== 1) throw new Error("ambiguous_row");
  return found[0];
}

/** Current BLS vintage, never represented as the initial release. M13 annual averages are excluded. */
export function parseEmployment(json: unknown, series: "earnings" | "unemployment"): FundamentalObservation[] {
  const payload = json as { status?: string; Results?: { series?: {
    seriesID: string; data: { year: string; period: string; value: string; footnotes?: { code?: string }[] }[];
  }[] } };
  const definition = fundamentalDefinitions[series];
  const matches = payload?.Results?.series?.filter(item => item.seriesID === definition.seriesId);
  if (payload?.status !== "REQUEST_SUCCEEDED" || matches?.length !== 1) throw new Error("bls_response");
  const points: FundamentalObservation[] = matches[0].data.filter(row => /^\d{4}$/.test(row.year) && /^M(0[1-9]|1[0-2])$/.test(row.period)
    && row.value.trim() !== "-")
    .map(row => {
      const value = numeric(row.value);
      if (value < 0 || (series === "unemployment" && value > 100)) throw new Error("invalid_value");
      return { period: row.year + "-" + row.period.slice(1), value, previous: null, sourceUrl: definition.url,
        publishedAt: null, vintage: "current", stage: row.footnotes?.some(note => note.code === "P") ? "preliminary" : "current" };
    });
  return points.map(point => ({ ...point, previous: points.find(prior => prior.period === previousMonth(point.period))?.value ?? null }));
}

/** National continued claims only. A report run date is not a release timestamp. */
export function parseContinuing(xml: string): FundamentalObservation[] {
  const vintage = xml.match(/<r539cyNational\s+rundate="(\d{2})\/(\d{2})\/(\d{4})"/);
  if (!vintage) throw new Error("dol_report_unverified");
  return blocks(xml, "week").flatMap(week => {
    const date = text(week, "weekEnded")?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const claim = text(blocks(week, "ContinuedClaims")[0] ?? "", "SA");
    if (!date || !claim || claim === "-") return [];
    const period = date[3] + "-" + date[1] + "-" + date[2];
    if (new Date(period).getUTCDay() !== 6) throw new Error("invalid_week");
    const value = numeric(claim);
    if (value < 0 || !Number.isInteger(value)) throw new Error("invalid_value");
    return [{ period, value, previous: null, sourceUrl: fundamentalDefinitions.continuing.url, publishedAt: null,
      vintage: vintage[3] + "-" + vintage[1] + "-" + vintage[2], stage: "current" as const }];
  }).map((point, _, points) => ({ ...point,
    previous: points.find(prior => Date.parse(point.period) - Date.parse(prior.period) === 7 * 86_400_000)?.value ?? null }));
}

/** The current month's published changes and previous from the same dated BEA table. */
export function parsePersonal(html: string, release: Omit<PceObservation, "values">, series: "income" | "consumption"): FundamentalObservation {
  const checked = verifyBeaRelease(html, release);
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0])
    .filter(table => /Personal Income and Related Measures/.test(table) && /Percent change from preceding month/.test(table));
  if (tables.length !== 1) throw new Error("bea_table_unverified");
  const rows = htmlRows(tables[0]);
  const headers = rows.filter(row => row.length === 3 && row[0] === "");
  const prior = previousMonth(release.period);
  if (headers.length !== 1 || headers[0][1] !== months[Number(prior.slice(5)) - 1]
    || headers[0][2] !== months[Number(release.period.slice(5)) - 1]) throw new Error("bea_columns_unverified");
  const row = onlyRow(rows, series === "income" ? "Current-dollar personal income" : "Current-dollar PCE");
  if (row.length !== 3) throw new Error("bea_columns_unverified");
  return { period: release.period, value: numeric(row[2]), previous: numeric(row[1]), sourceUrl: release.url,
    publishedAt: release.publishedAt, vintage: checked.vintageId ?? release.publishedAt, stage: "initial" };
}

/** Retail changes are explicitly published in the current release; no calculations from later sales levels. */
export function parseRetail(html: string): FundamentalObservation[] {
  const body = plainText(html);
  const release = body.match(/FOR IMMEDIATE RELEASE: [A-Za-z]+, ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  const data = body.match(/Advance estimates of U\.S\. retail and food services sales for ([A-Za-z]+) (\d{4}), adjusted for seasonal variation and holiday and trading-day differences, but not for price changes, were \$[\d,.]+ billion, (up|down) (\d+\.\d+) percent/);
  const id = body.match(/\bCB\d{2}-\d+\b/);
  if (!release || !data || !id) throw new Error("census_release_unverified");
  const date = monthPeriod(release[1], Number(release[3])) + "-" + release[2].padStart(2, "0");
  const period = monthPeriod(data[1], Number(data[2]));
  if (period !== previousMonth(date.slice(0, 7))) throw new Error("census_period_unverified");
  const prior = previousMonth(period);
  // Previous-month growth is often described as August to September for an October release.
  const priorPrior = previousMonth(prior);
  const previousMatch = new RegExp(months[Number(priorPrior.slice(5)) - 1] + " " + priorPrior.slice(0, 4) + " to " +
    months[Number(prior.slice(5)) - 1] + " " + prior.slice(0, 4) +
    " percent change was (?:unrevised from|revised to) (up|down) (\\d+\\.\\d+) percent").exec(body);
  const previous = previousMatch ? (previousMatch[1] === "down" ? -1 : 1) * Number(previousMatch[2]) : null;
  return [{ period, value: (data[3] === "down" ? -1 : 1) * Number(data[4]), previous,
    publishedAt: date, sourceUrl: fundamentalDefinitions.retail.url, vintage: id[0], stage: "initial" }];
}

/** The summary's monthly percent changes all belong to one G.17 release vintage. */
export function parseProduction(html: string): FundamentalObservation[] {
  const body = plainText(html);
  const release = body.match(/Release Date: ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  const lead = body.match(/Industrial production \(IP\) (?:increased|decreased|rose|fell|was unchanged).*? in ([A-Za-z]+)(?: after|\.)/);
  if (!release || !lead || !body.includes("Seasonally adjusted")) throw new Error("fed_release_unverified");
  const date = monthPeriod(release[1], Number(release[3])) + "-" + release[2].padStart(2, "0");
  const period = previousMonth(date.slice(0, 7));
  if (months[Number(period.slice(5)) - 1] !== lead[1]) throw new Error("fed_period_unverified");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0])
    .filter(table => /Percent(?:&nbsp;|\s)+change/.test(table) && /Total(?:&nbsp;|\s)+index/.test(table));
  if (tables.length !== 1) throw new Error("fed_table_unverified");
  const rows = htmlRows(tables[0]);
  const row = onlyRow(rows, "Total index");
  const headers = rows.find(header => header.length === 12 && header.every(cell => /\[(r|p)\]/.test(cell)));
  if (row.length !== 14 || !headers) throw new Error("fed_columns_unverified");
  const points: FundamentalObservation[] = [];
  let expected = period;
  for (let i = 5; i >= 0; i--) {
    const fullMonth = months[Number(expected.slice(5)) - 1];
    const header = headers[i + 6].replace(/\[(r|p)\]/, "").replace(".", "").trim();
    if (!fullMonth.startsWith(header)) throw new Error("fed_columns_unverified");
    points.push({ period: expected, value: numeric(row[i + 7]), previous: i > 0 ? numeric(row[i + 6]) : null,
      sourceUrl: fundamentalDefinitions.production.url, publishedAt: date, vintage: date,
      stage: headers[i + 6].includes("[p]") ? "preliminary" : "revised" });
    expected = previousMonth(expected);
  }
  return points;
}
