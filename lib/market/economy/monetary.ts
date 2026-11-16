import { dayMs, dollarChanges, effectiveRateSource, monetarySources, type MonetaryPoint, type MonetarySeries, type MonetarySnapshot } from "./monetary-data";

const monthNames = "January February March April May June July August September October November December".split(" ");
const archive = "https://home.treasury.gov/system/files/276/yield-curve-rates-1990-2024.csv";
const csvBase = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv";
const retriesByOrigin = new Map<string, number>();

function iso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

function ordered(points: MonetaryPoint[], today: string) {
  const byDate = new Map<string, MonetaryPoint>();
  for (const point of points) {
    if (!point.date || point.date > today || point.values.every(value => value === null)) continue;
    const prior = byDate.get(point.date);
    if (prior && prior.values.some((value, index) => value !== point.values[index])) throw new Error("conflicting_observation");
    byDate.set(point.date, point);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function cells(row: string) {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cell[1].replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim());
}

export function parseBroad(html: string, today: string) {
  if (!html.includes("Nominal Broad Dollar Index - Daily Index")) throw new Error("unexpected_h10_series");
  const points = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(row => {
    const [date, value] = cells(row[1]);
    const parts = date?.match(/^(\d{1,2})-([A-Z]{3})-(\d{2})$/i);
    if (!parts || !/^\d+\.\d{4}$/.test(value)) return [];
    const month = monthNames.findIndex(name => name.slice(0, 3).toUpperCase() === parts[2].toUpperCase()) + 1;
    return [{ date: iso(2000 + Number(parts[3]), month, Number(parts[1])), values: [Number(value)] }];
  });
  const base = points.filter(point => point.date.startsWith("2006-01-"));
  if (base.length < 20 || Math.abs(base.reduce((sum, point) => sum + point.values[0], 0) / base.length - 100) > 0.001) {
    throw new Error("unexpected_h10_base");
  }
  const release = html.match(/Release Date:\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  const date = release ? iso(+release[3], monthNames.indexOf(release[1]) + 1, +release[2]) : "";
  const releasedOn = date && date <= today ? date : undefined;
  return { points: ordered(points, releasedOn ?? today), releasedOn };
}

export function parsePolicy(html: string, today: string) {
  const points = [...html.matchAll(/<h4\b[^>]*>\s*(\d{4})\s*<\/h4>\s*(?:<div\b[^>]*>\s*)?<table\b[^>]*>([\s\S]*?)<\/table>/gi)].flatMap(section =>
    [...section[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(row => {
      const [date, , , level] = cells(row[1]);
      const parts = date?.match(/^([A-Za-z]+)\s+(\d{1,2})\*?$/);
      if (!parts || !level || !/^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?$/.test(level)) return [];
      const [lower, upper = lower] = level.split(/[-–]/).map(Number);
      if (lower > upper) return [];
      return [{ date: iso(+section[1], monthNames.indexOf(parts[1]) + 1, +parts[2]), values: [lower, upper] }];
    }));
  return ordered(points, today);
}

export function parseYields(csv: string, today: string) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const split = (row: string) => row.split(",").map(value => value.trim().replace(/^"|"$/g, ""));
  const headers = split(header).map(value => value.toLowerCase());
  const columns = ["3 mo", "2 yr", "5 yr", "10 yr", "30 yr"].map(name => headers.lastIndexOf(name));
  if (headers[0] !== "date" || columns.some(index => index < 1)) throw new Error("unexpected_yield_columns");
  const points = lines.flatMap(line => {
    const row = split(line);
    const parts = row[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!parts) return [];
    const year = +parts[3] + (parts[3].length === 2 ? (+parts[3] >= 90 ? 1900 : 2000) : 0);
    const values = columns.map(index => /^-?\d+(?:\.\d{1,2})?$/.test(row[index] ?? "") ? Number(row[index]) : null);
    if (values.every(value => value === null)) return [];
    const spread = (short: number) => values[3] !== null && values[short] !== null ? Math.round(values[3] * 100) - Math.round(values[short] * 100) : null;
    return [{ date: iso(year, +parts[1], +parts[2]), values: [...values, spread(1), spread(0)] }];
  });
  return ordered(points, today);
}

export class MonetaryFailure extends Error {
  constructor(category: string, readonly retryAt?: number) { super(category); }
}

export async function loadMonetary(series: MonetarySeries, history: boolean, today: string, read = fetch): Promise<Omit<MonetarySnapshot, "status">> {
  async function request(url: string, contentType: string) {
    const origin = new URL(url).origin;
    const paused = retriesByOrigin.get(origin);
    if (paused && paused > Date.now()) throw new MonetaryFailure("cooldown", paused);
    const response = await read(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000) });
    if (!response.ok) {
      const retry = response.headers.get("Retry-After");
      const retryAt = retry === null ? undefined : /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
      if (retryAt && Number.isFinite(retryAt)) retriesByOrigin.set(origin, Math.max(retryAt, retriesByOrigin.get(origin) ?? 0));
      throw new MonetaryFailure("http_" + response.status, retryAt);
    }
    if (!response.headers.get("Content-Type")?.toLowerCase().includes(contentType)) throw new MonetaryFailure("content_type");
    return response;
  }
  if (series === "dollar") {
    const { points, releasedOn } = parseBroad(await (await request(monetarySources.dollar, "text/html")).text(), today);
    return { points: history ? points : points.slice(-1), releasedOn, dollarChanges: dollarChanges(points) };
  }
  if (series === "policy") {
    const [range, effective] = await Promise.allSettled([
      request(monetarySources.policy, "text/html").then(response => response.text()).then(html => parsePolicy(html, today)),
      history ? Promise.resolve(undefined) : request(effectiveRateSource, "application/json").then(response => response.json()).then(body => {
        const rate = body?.refRates?.[0];
        const date = typeof rate?.effectiveDate === "string" ? rate.effectiveDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
        if (rate?.type !== "EFFR" || typeof rate.percentRate !== "number" || !Number.isFinite(rate.percentRate)
          || !date || iso(+date[1], +date[2], +date[3]) !== rate.effectiveDate || rate.effectiveDate > today) {
          throw new MonetaryFailure("invalid_effr");
        }
        return { date: rate.effectiveDate as string, values: [rate.percentRate as number] };
      }),
    ]);
    if (range.status === "rejected") throw range.reason;
    if (effective.status === "rejected") console.warn(JSON.stringify({
      event: "monetary_read_failed", series: "effr",
      category: effective.reason instanceof MonetaryFailure ? effective.reason.message : "invalid_or_network",
    }));
    return { points: history ? range.value : range.value.slice(-1), effectiveRate: effective.status === "fulfilled" ? effective.value : undefined };
  }
  const year = Number(today.slice(0, 4));
  const latestYears = history ? Array.from({ length: Math.min(6, Math.max(0, year - 2024)) }, (_, index) => year - index)
    : today.slice(5) <= "02-01" ? [year, year - 1] : [year];
  const urls = latestYears.map(value => csvBase + "/" + value + "/all?type=daily_treasury_yield_curve&field_tdr_date_value=" + value + "&page&_format=csv");
  if (history) urls.push(archive);
  const points: MonetaryPoint[] = [];
  for (const url of urls) points.push(...parseYields(await (await request(url, "text/csv")).text(), today));
  const first = new Date(Date.parse(today) - 31 * dayMs).toISOString().slice(0, 10);
  return { points: ordered(points, today).filter(point => history || point.date >= first) };
}
