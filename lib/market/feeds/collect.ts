import type { EventResult, EventRow, NewsRow } from "./types";
import { FEEDS, beaReleases, beaSchedule, ecbPress, fedMonetary, fedSpeeches, whiteHouseActions, whiteHouseNews } from "./sources";
import { listedEvents } from "./schedules";
import { BLS_API_V1, BLS_API_V2, BLS_FIGURE_CODES, blsLatest, blsRequestBody, blsResults, parseBlsResponse } from "./bls";
import { EIA_SERIES, type EiaCode, eiaLatest, eiaResult, eiaUrl, parseEia } from "./eia";
import { DOL_RELEASE_URL, claimsResult, parseClaims } from "./dol";
import { CENSUS_SERIES, censusLatest, censusResult, censusUrl, parseCensus } from "./census";
import { fetchCensus } from "./census-fetch";
import { CENSUS_RELEASES } from "./schedules-us";
import { pdfText } from "./pdf-text";
import { EUROSTAT_ICS, EUROSTAT_SERIES, type EurostatCode, eurostatLatest, eurostatResult, eurostatSchedule, eurostatUrl, parseEurostat } from "./eurostat";

/**
 * The collector (docs/market-feeds-plan.md, section 4): reads the official feeds, turns them into calendar events and
 * news, and writes them. The network and the database are passed in, so tests run on saved feed samples.
 * Each source is on its own: one failing never stops the others, and every run is logged.
 */

export interface FeedsDb {
  /** Schedule columns only: a published figure, status or the owner's «hidden» are kept. */
  upsertEvents(rows: EventRow[]): Promise<void>;
  /** Figures for events that exist (never creates an event). */
  saveResults(rows: EventResult[]): Promise<void>;
  /** New news only: an item already stored (perhaps hidden by the owner) is left as it is. */
  insertNews(rows: NewsRow[]): Promise<void>;
  existingEventIds(ids: string[]): Promise<Set<string>>;
  releasedEventIds(ids: string[]): Promise<Set<string>>;
  /** Stored data releases of a source that started between `from` and `to` (ms) and have no figure yet. */
  waitingEvents(source: string, from: number, to: number): Promise<WaitingEvent[]>;
  /** Stored scheduled events (any source) starting between `from` and `to`, with their «previous». */
  scheduledEvents(from: number, to: number): Promise<ScheduledEvent[]>;
  /** Stored releases with a figure since `from` (the last figure of each indicator). */
  releasedFigures(from: number): Promise<{ id: string; source: string; code: string | null; starts_at: string; actual: string | null }[]>;
  /** «Previous» of scheduled events (a published figure is never touched). */
  setPrevious(rows: { id: string; previous: string }[]): Promise<void>;
  /** When this source last ran (ms), for throttling. */
  lastRun(source: string): Promise<number | null>;
  logRun(run: RunLog): Promise<void>;
  prune(): Promise<number>;
}

export interface WaitingEvent {
  id: string;
  code: string | null;
  starts_at: string;
}

export interface ScheduledEvent extends WaitingEvent {
  source: string;
  previous: string | null;
}

export interface RunLog {
  source: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  items: number;
  error: string | null;
}

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; redirect?: "manual"; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }>;

/**
 * news — every news feed and the figures; releases — only BEA's releases and the BLS figures (the frequent run
 * around 8:30 / 10:00 ET, so the other feeds are not asked every two minutes); schedules — the calendar; all.
 */
export type Scope = "news" | "releases" | "schedules" | "all";

export interface CollectOptions {
  scope: Scope;
  prune?: boolean;
  now: number;
  fetch: Fetcher;
  db: FeedsDb;
  /** Optional free BLS key: 500 requests a day instead of 25. */
  blsKey?: string;
  /** Free EIA key (`EIA_API_KEY`): without it the EIA figures are not asked for, and the log says so. */
  eiaKey?: string;
  /** Required by the official Census Data API; server-only, never logged. */
  censusKey?: string;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  items: number;
  error: string | null;
}

/** Identifies the program and where to report a problem (the sources ask for it). */
export const USER_AGENT = "AYRA-Trading-market-feeds/1.0 (+https://github.com/Malkis99/ayra_trading)";
const TIMEOUT_MS = 15_000;
/** BLS: ask the API at most this often, and only this long after a release. */
export const BLS_EVERY_MS = 10 * 60_000;
export const BLS_WINDOW_MS = 2 * 60 * 60_000;
/** EIA, Census, DOL: the same pace; EIA's API may take up to two hours after a report, so it gets three. */
export const FIGURES_EVERY_MS = 10 * 60_000;
export const EIA_WINDOW_MS = 3 * 60 * 60_000;
export const FIGURES_WINDOW_MS = 2 * 60 * 60_000;

async function get(fetcher: Fetcher, url: string): Promise<string> {
  const res = await withTimeout(fetcher(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/calendar, text/plain, */*" } }));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** Only the last 90 days (what the tables keep) and nothing far in the future (a feed's broken date). */
export const NEWS_DAYS = 90;
export function recent(rows: NewsRow[], now: number): NewsRow[] {
  const from = now - NEWS_DAYS * 86_400_000;
  const to = now + 86_400_000;
  return rows.filter((r) => {
    const at = Date.parse(r.published_at);
    return at >= from && at <= to;
  });
}

/** One story once: the first item of each dedupe key (feeds come newest first). */
export function dedupe(rows: NewsRow[]): NewsRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.dedupe_key) ? false : (seen.add(r.dedupe_key), true)));
}

/** Links to events that are not stored (an older meeting) are dropped, so the write never fails on them. */
async function linkable(db: FeedsDb, rows: NewsRow[]): Promise<NewsRow[]> {
  const ids = Array.from(new Set(rows.map((r) => r.event_id).filter((x): x is string => !!x)));
  if (!ids.length) return rows;
  const have = await db.existingEventIds(ids);
  return rows.map((r) => (r.event_id && !have.has(r.event_id) ? { ...r, event_id: null } : r));
}

export async function collectFeeds(o: CollectOptions): Promise<{ results: SourceResult[]; pruned: number | null }> {
  const results: SourceResult[] = [];
  // the log's times follow the collector's own clock («now»), so the pace of retries works the same in tests
  const t0 = Date.now();
  const clock = () => o.now + (Date.now() - t0);
  const run = async (source: string, job: () => Promise<number>) => {
    const started = clock();
    let r: SourceResult;
    try {
      r = { source, ok: true, items: await job(), error: null };
    } catch (e) {
      r = { source, ok: false, items: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) };
    }
    results.push(r);
    try {
      await o.db.logRun({ ...r, started_at: new Date(started).toISOString(), finished_at: new Date(clock()).toISOString() });
    } catch {
      // the log is a convenience: never fail a run because of it
    }
  };

  const schedules = o.scope === "schedules" || o.scope === "all";
  const newsScope = o.scope === "news" || o.scope === "all";
  const releasesScope = newsScope || o.scope === "releases";

  if (schedules) {
    await run("schedules-listed", async () => {
      const rows = listedEvents();
      await o.db.upsertEvents(rows);
      return rows.length;
    });
    await run("bea-schedule", async () => {
      const rows = beaSchedule(await get(o.fetch, FEEDS.beaIcs), o.now);
      await o.db.upsertEvents(rows);
      return rows.length;
    });
    await run("eurostat-schedule", async () => {
      const rows = eurostatSchedule(await get(o.fetch, EUROSTAT_ICS), o.now);
      await o.db.upsertEvents(rows);
      return rows.length;
    });
    await previousValues(o, run);
  }

  if (newsScope) {
    const newsJob = (parse: (xml: string) => NewsRow[], url: string) => async () => {
      const rows = dedupe(await linkable(o.db, recent(parse(await get(o.fetch, url)), o.now)));
      await o.db.insertNews(rows);
      return rows.length;
    };
    await run("fed-monetary", newsJob(fedMonetary, FEEDS.fedMonetary));
    await run("fed-speeches", newsJob((x) => fedSpeeches(x, "speech"), FEEDS.fedSpeeches));
    await run("fed-testimony", newsJob((x) => fedSpeeches(x, "testimony"), FEEDS.fedTestimony));
    await run("ecb-press", newsJob(ecbPress, FEEDS.ecbPress));
    await run("whitehouse-actions", newsJob(whiteHouseActions, FEEDS.whActions));
    await run("whitehouse-news", newsJob(whiteHouseNews, FEEDS.whNews));
  }

  if (releasesScope) {
    await run("bea-releases", async () => {
      const { news, results: figures } = beaReleases(await get(o.fetch, FEEDS.beaRss));
      const rows = dedupe(await linkable(o.db, recent(news, o.now)));
      await o.db.insertNews(rows);
      const have = await o.db.existingEventIds(figures.map((f) => f.id));
      const known = figures.filter((f) => have.has(f.id));
      await o.db.saveResults(known);
      // BEA ids end with the release day: the next release of the same indicator is on a later day
      await carryForward(o, known.filter((f) => f.actual).map((f) => ({ code: f.id.split(":")[1], actual: f.actual!, at: `${f.id.split(":")[2]}T23:59:59.999Z` })));
      return rows.length + known.length;
    });
    await blsFigures(o, run);
    await eiaFigures(o, run);
    await censusFigures(o, run);
    await dolFigures(o, run);
    await eurostatFigures(o, run);
  }

  const pruned = o.prune ? await o.db.prune() : null;
  return { results, pruned };
}

type Run = (source: string, job: () => Promise<number>) => Promise<void>;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Figures not in yet are asked for again for a week after the release, less often as it ages. */
export const RETRY_DAYS = 7;

/**
 * How long to wait before asking a source again for a figure that has not come: every 10 minutes right after the
 * release (two hours, three for EIA, whose API may take that long), every 30 minutes for the rest of the first day,
 * then once a day up to a week. Without a BLS key (25 requests a day) the first day's pace is hourly.
 */
export function retryEvery(ageMs: number, fastMs: number, slowMs = 30 * 60_000): number {
  if (ageMs <= fastMs) return FIGURES_EVERY_MS;
  if (ageMs <= DAY) return slowMs;
  return DAY;
}

/** The source's stored releases of the last week still without a figure — empty when it is not time to ask again. */
async function due(o: CollectOptions, source: string, runName: string, opts: { fastMs: number; slowMs?: number; codes?: readonly string[] }): Promise<WaitingEvent[]> {
  const waiting = (await o.db.waitingEvents(source, o.now - RETRY_DAYS * DAY, o.now)).filter((e) => !opts.codes || (e.code !== null && opts.codes.includes(e.code)));
  if (!waiting.length) return [];
  const every = Math.min(...waiting.map((e) => retryEvery(o.now - Date.parse(e.starts_at), opts.fastMs, opts.slowMs)));
  const last = await o.db.lastRun(runName);
  return last !== null && o.now - last < every ? [] : waiting;
}

async function json(o: CollectOptions, url: string, what: string): Promise<unknown> {
  const res = await withTimeout(o.fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${what}`);
  return JSON.parse(await res.text());
}

/**
 * «Previous» before a release: the figure of the last release of the same indicator becomes the «previous» of its
 * next scheduled release (the source's own, possibly revised, value replaces it when that release comes out).
 */
async function carryForward(o: CollectOptions, figures: { code: string; actual: string; at: string }[]): Promise<number> {
  const known = figures.filter((f) => f.actual);
  if (!known.length) return 0;
  const upcoming = await o.db.scheduledEvents(o.now - RETRY_DAYS * DAY, o.now + 120 * DAY);
  const rows: { id: string; previous: string }[] = [];
  for (const code of Array.from(new Set(known.map((f) => f.code)))) {
    const last = known.filter((f) => f.code === code).sort((a, b) => b.at.localeCompare(a.at))[0];
    const next = upcoming.filter((e) => e.code === code && e.starts_at > last.at).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    if (next && next.previous !== last.actual) rows.push({ id: next.id, previous: last.actual });
  }
  if (rows.length) await o.db.setPrevious(rows);
  return rows.length;
}

/** Save figures and pass each on as the next release's «previous». */
async function save(o: CollectOptions, results: EventResult[], waiting: WaitingEvent[]): Promise<void> {
  await o.db.saveResults(results);
  const at = new Map(waiting.map((e) => [e.id, e]));
  await carryForward(
    o,
    results.filter((r) => r.actual && at.get(r.id)?.code).map((r) => ({ code: at.get(r.id)!.code!, actual: r.actual!, at: at.get(r.id)!.starts_at }))
  );
}

/** BLS: the main releases from the official API (one request asks every series). */
async function blsData(o: CollectOptions) {
  const res = await withTimeout(
    o.fetch(o.blsKey ? BLS_API_V2 : BLS_API_V1, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: blsRequestBody(o.blsKey, new Date(o.now).getUTCFullYear()),
    })
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} BLS API`);
  const body = JSON.parse(await res.text());
  if (body?.status && body.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API: ${String(body.status)} ${JSON.stringify(body.message ?? "").slice(0, 300)}`);
  return parseBlsResponse(body);
}

async function blsFigures(o: CollectOptions, run: Run) {
  const waiting = await due(o, "bls", "bls-api", { fastMs: BLS_WINDOW_MS, slowMs: o.blsKey ? 30 * 60_000 : HOUR, codes: BLS_FIGURE_CODES });
  if (!waiting.length) return;
  await run("bls-api", async () => {
    const figures = blsResults(waiting.map((e) => e.id), await blsData(o));
    await save(o, figures, waiting);
    return figures.length;
  });
}

/** EIA's weekly crude and gas storage: the week's change from the API (key required). */
async function eiaFigures(o: CollectOptions, run: Run) {
  const waiting = await due(o, "eia", "eia-api", { fastMs: EIA_WINDOW_MS });
  if (!waiting.length) return;
  await run("eia-api", async () => {
    if (!o.eiaKey) throw new Error("EIA_API_KEY is not set: EIA figures are not asked for");
    const out = [];
    for (const code of Array.from(new Set(waiting.map((e) => e.id.split(":")[1] as EiaCode)))) {
      // the key is in the URL as EIA asks; the error message names the series, never the URL
      const values = parseEia(await json(o, eiaUrl(code, o.eiaKey), `EIA API ${code}`));
      for (const e of waiting.filter((x) => x.id.split(":")[1] === code)) {
        const r = eiaResult(e.id, values);
        if (r) out.push(r);
      }
    }
    await save(o, out, waiting);
    return out.length;
  });
}

/** Census: retail sales, durable goods, housing starts, new home sales from its Economic Indicators API. */
async function censusFigures(o: CollectOptions, run: Run) {
  const waiting = await due(o, "census", "census-api", { fastMs: FIGURES_WINDOW_MS, codes: Object.keys(CENSUS_RELEASES) });
  if (!waiting.length) return;
  await run("census-api", async () => {
    const out = [];
    const missing: string[] = [];
    const errors: string[] = [];
    // each release on its own: one failing never keeps the others' figures from being saved
    for (const e of waiting) {
      const [, code, day] = e.id.split(":") as [string, keyof typeof CENSUS_RELEASES, string];
      const ref = CENSUS_RELEASES[code]?.dates[day];
      if (!ref) continue;
      try {
        const r = censusResult(e.id, parseCensus(await fetchCensus(o.fetch, censusUrl(code, ref), o.censusKey, code), CENSUS_SERIES[code].category));
        if (r) out.push(r);
        else missing.push(`${code} ${ref}`);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    await save(o, out, waiting);
    if (errors.length) throw new Error(Array.from(new Set(errors)).join("; "));
    // not out yet is normal for a few minutes; after that the log shows what the answer lacked
    if (missing.length && !out.length) throw new Error(`Census API: no figure yet for ${missing.join(", ")}`);
    return out.length;
  });
}

/** DOL: the current weekly claims release (PDF): its day and headline figures. */
async function dolRelease(o: CollectOptions) {
  const res = await withTimeout(o.fetch(DOL_RELEASE_URL, { headers: { "User-Agent": USER_AGENT, Accept: "application/pdf" } }));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${DOL_RELEASE_URL}`);
  if (!res.arrayBuffer) throw new Error("DOL: the answer cannot be read as a file");
  const release = parseClaims(pdfText(new Uint8Array(await res.arrayBuffer())));
  if (!release) throw new Error("DOL: the release's wording was not found");
  return release;
}

async function dolFigures(o: CollectOptions, run: Run) {
  const waiting = await due(o, "dol", "dol-claims", { fastMs: FIGURES_WINDOW_MS });
  if (!waiting.length) return;
  await run("dol-claims", async () => {
    // DOL keeps only the current release online: an older week's figure cannot be read any more
    const out = claimsResult(waiting.map((e) => e.id), await dolRelease(o));
    await save(o, out, waiting);
    return out.length;
  });
}

/** Eurostat: the euro area's figure from its API once the dataset is updated with the release. */
async function eurostatFigures(o: CollectOptions, run: Run) {
  const waiting = await due(o, "eurostat", "eurostat-api", { fastMs: FIGURES_WINDOW_MS });
  if (!waiting.length) return;
  await run("eurostat-api", async () => {
    const out = [];
    const errors: string[] = [];
    const asked = new Map<string, Promise<ReturnType<typeof parseEurostat>>>();
    // each release on its own (two come out the same morning); one dataset is asked once
    for (const e of waiting) {
      const code = e.id.split(":")[1] as EurostatCode;
      const url = eurostatUrl(code);
      if (!asked.has(url)) asked.set(url, json(o, url, `Eurostat API ${code}`).then(parseEurostat));
      try {
        const r = eurostatResult(e.id, e.starts_at, await asked.get(url)!);
        if (r) out.push(r);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    await save(o, out, waiting);
    if (errors.length) throw new Error(Array.from(new Set(errors)).join("; "));
    return out.length;
  });
}

/**
 * «Previous» for the next release of every indicator, once a day with the schedules: the last stored release's
 * figure (BEA and every source once it has a release here), otherwise the latest figure the source publishes now
 * (the first time, before any release was collected). Only the nearest scheduled release of each indicator gets it.
 */
async function previousValues(o: CollectOptions, run: Run) {
  await run("previous-values", async () => {
    const upcoming = (await o.db.scheduledEvents(o.now, o.now + 120 * DAY)).filter((e) => e.code);
    const next = new Map<string, ScheduledEvent>();
    for (const e of upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at))) if (!next.has(e.code!)) next.set(e.code!, e);
    const stored = await o.db.releasedFigures(o.now - 120 * DAY);
    const latest = new Map<string, string>();
    for (const f of stored.sort((a, b) => b.starts_at.localeCompare(a.starts_at))) if (f.code && f.actual && !latest.has(f.code)) latest.set(f.code, f.actual);

    // the first time: ask the sources for what they publish now (each on its own: one failing keeps the rest)
    const missing = (codes: readonly string[]) => codes.filter((c) => next.has(c) && !latest.has(c));
    const errors: string[] = [];
    const tryAsk = async (what: string, job: () => Promise<void>) => {
      try {
        await job();
      } catch (e) {
        errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    if (missing(BLS_FIGURE_CODES).length) await tryAsk("BLS", async () => setAll(latest, blsLatest(await blsData(o))));
    if (o.eiaKey && missing(Object.keys(EIA_SERIES)).length) {
      for (const code of missing(Object.keys(EIA_SERIES)) as EiaCode[]) await tryAsk("EIA", async () => setOne(latest, code, eiaLatest(code, parseEia(await json(o, eiaUrl(code, o.eiaKey!), `EIA API ${code}`)))));
    }
    for (const code of missing(Object.keys(EUROSTAT_SERIES)) as EurostatCode[]) {
      await tryAsk("Eurostat", async () => setOne(latest, code, eurostatLatest(code, parseEurostat(await json(o, eurostatUrl(code), `Eurostat API ${code}`)), next.get(code)!.starts_at, o.now)));
    }
    for (const code of missing(Object.keys(CENSUS_RELEASES)) as (keyof typeof CENSUS_RELEASES)[]) {
      const ref = CENSUS_RELEASES[code].dates[next.get(code)!.id.split(":")[2]];
      if (ref) await tryAsk("Census", async () => setOne(latest, code, censusLatest(code, ref, parseCensus(await fetchCensus(o.fetch, censusUrl(code, ref), o.censusKey, code), CENSUS_SERIES[code].category))));
    }
    if (missing(["us_jobless_claims"]).length) await tryAsk("DOL", async () => setOne(latest, "us_jobless_claims", (await dolRelease(o)).actual));

    const rows = Array.from(next.values())
      .filter((e) => latest.has(e.code!) && e.previous !== latest.get(e.code!))
      .map((e) => ({ id: e.id, previous: latest.get(e.code!)! }));
    if (rows.length) await o.db.setPrevious(rows);
    if (errors.length) throw new Error(`${rows.length} set; ${Array.from(new Set(errors)).join("; ")}`.slice(0, 1900));
    return rows.length;
  });
}

const setAll = (into: Map<string, string>, from: Map<string, string>) => from.forEach((v, k) => into.has(k) || into.set(k, v));
const setOne = (into: Map<string, string>, code: string, value: string | null) => {
  if (value && !into.has(code)) into.set(code, value);
};
