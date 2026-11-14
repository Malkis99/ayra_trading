import type { EventResult, EventRow, NewsRow, ReleaseCompletion } from "./types";
import { FEEDS, beaReleases, beaSchedule, ecbPress, fedMonetary, fedSpeeches, whiteHouseActions, whiteHouseNews } from "./sources";
import { listedEvents } from "./schedules";
import { BLS_API_V1, BLS_API_V2, BLS_FIGURE_CODES, blsLatest, blsRequestBody, blsResults, parseBlsResponse } from "./bls";
import { EIA_SERIES, type EiaCode, eiaLatest, eiaResult, eiaUrl, parseEia } from "./eia";
import { DOL_RELEASE_URL, claimsResult, parseClaims } from "./dol";
import { CENSUS_SERIES, censusLatest, censusResult, censusUrl, parseCensus } from "./census";
import { fetchCensus } from "./census-fetch";
import { CENSUS_RELEASES } from "./schedules-us";
import { pdfText } from "./pdf-text";
import { icsCancellations } from "./ics";
import { previousPeriod } from "./identity";
import { CPI_METRICS, cpiAbsences, cpiReleaseUrl, cpiResults, isCpiCode, parseCpiRelease, verifiedCpiMeta } from "./cpi";
import { nyDay } from "./time";
import { PPI_METRICS, PPI_SCHEDULE_URL, isPpiCode, parsePpiRelease, ppiReleaseUrl, ppiResults, verifiedPpiMeta } from "./ppi";
import { JOLTS_CODE, JOLTS_SCHEDULE_URL, joltsReleaseUrl, parseJoltsRelease, joltsResults, verifiedJoltsMeta } from "./jolts";
import { joltsSchedule, ppiSchedule } from "./bls-schedule";
import { ONS_LISTS, onsBulletinUrl, onsCalendarUrl, onsGdpResult, onsMoveSequence, onsSchedules, type StoredOnsSchedule } from "./ons-gdp";
import { type OnsBudget, type OnsRequestKind, withOnsSlot } from "./ons-budget";
import { eurostatCalendarUrl, EUROSTAT_SERIES, type EurostatCode, eurostatLatest, eurostatResult, eurostatSchedule, eurostatUrl, parseEurostat } from "./eurostat";

/**
 * The collector (docs/market-feeds-plan.md, section 4): reads the official feeds, turns them into calendar events and
 * news, and writes them. The network and the database are passed in, so tests run on saved feed samples.
 * Each source is on its own: one failing never stops the others, and every run is logged.
 */

export interface FeedsDb {
  reserveRelease?(family: "cpi" | "nfp", ids: string[]): Promise<string | null>;
  finishRelease?(token: string, completion: ReleaseCompletion): Promise<void>;
  cancelEvents(rows: { source: string; source_uid: string; schedule_meta: import("./types").ScheduleMeta }[]): Promise<void>;
  revisionEvents(source: string, from: number, to: number): Promise<WaitingEvent[]>;
  matchResults(rows: EventResult[]): Promise<EventResult[]>;
  /** Schedule columns only: a published figure, status or the owner's «hidden» are kept. */
  upsertEvents(rows: EventRow[]): Promise<void>;
  onsSchedules(): Promise<StoredOnsSchedule[]>;
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
  releasedFigures(from: number): Promise<{ id: string; source: string; code: string | null; starts_at: string; actual: string | null; reference_period?: string | null; result_meta?: import("./types").ResultMeta | null }[]>;
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
  reference_period?: string | null;
  release_stage?: string | null;
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
  onsBudget?: OnsBudget;
  onsFetch?: Fetcher;
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

function withTimeout<T>(p: Promise<T>, timeout = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeout);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** BLS publication HTML: one deadline covers headers AND body; abandon the request when it expires. */
async function getBlsText(fetcher: Fetcher, url: string, singleRequest = false): Promise<string> {
  const abort = new AbortController();
  try {
    return await withTimeout((async () => {
      const response = await fetcher(url, {headers:{"User-Agent":USER_AGENT,Accept:"text/html"},signal:abort.signal,...(singleRequest ? {redirect:"manual" as const} : {})});
      if (!response.ok) throw new ReleaseHttpError(response.status, url, response.headers?.get("retry-after"));
      return response.text();
    })());
  } finally { abort.abort(); }
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
  const run: Run = async (source, job) => {
    const started = clock();
    let r: SourceResult;
    try {
      const outcome = await job();
      const { items, issues } = typeof outcome === "number" ? { items: outcome, issues: [] } : outcome;
      r = { source, ok: issues.length === 0, items, error: issues.length ? [...new Set(issues)].join("; ").slice(0, 2000) : null };
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
  const isolated = async (name: string, job: () => Promise<void>) => {
    try { await job(); } catch (err) { await run(name, async () => { throw err; }); }
  };

  if (schedules) {
    const ons = isolated("ons-gdp-schedule", async () => {
      const last = await o.db.lastRun("ons-gdp-schedule");
      if (last !== null && new Date(last).toISOString().slice(0, 10) === new Date(o.now).toISOString().slice(0, 10)) return;
      const daily = await o.onsBudget?.daily();
      if (o.onsBudget && !daily) return;
      let facts: (() => Promise<SourceOutcome>) | undefined;
      let ready = false;
      try {
        await run("ons-gdp-schedule", async () => {
          const schedule = await collectOnsSchedules(o, daily);
          facts = schedule.facts;
          ready = schedule.issues.length === 0;
          return schedule;
        });
        if (facts) await run("ons-gdp-facts", facts);
      } finally {
        if (daily) await o.onsBudget?.daily(daily, ready);
      }
    });
    await run("schedules-listed", async () => {
      const rows = listedEvents().filter(e => !isPpiCode(e.code) && e.code !== JOLTS_CODE);
      await o.db.upsertEvents(rows);
      return rows.length;
    });
    await isolated("bls-ppi-schedule", async () => {
      const last = await o.db.lastRun("bls-ppi-schedule");
      if (last !== null && new Date(last).toISOString().slice(0,10) === new Date(o.now).toISOString().slice(0,10)) return;
      await run("bls-ppi-schedule", async () => {
        // Existing reviewed dates are a one-time bootstrap, never a daily writer reverting a live move.
        if (last === null) await o.db.upsertEvents(listedEvents().filter(e => isPpiCode(e.code)));
        const rows = ppiSchedule(await getBlsText(o.fetch, PPI_SCHEDULE_URL));
        await o.db.upsertEvents(rows);
        if (!rows.some(e => Date.parse(e.starts_at) > o.now)) throw new Error("BLS PPI schedule: official future horizon exhausted; existing events retained");
        return rows.length;
      });
    });
    await isolated("bls-jolts-schedule", async () => {
      const last = await o.db.lastRun("bls-jolts-schedule");
      if (last !== null && new Date(last).toISOString().slice(0,10) === new Date(o.now).toISOString().slice(0,10)) return;
      await run("bls-jolts-schedule", async () => {
        if (last === null) await o.db.upsertEvents(listedEvents().filter(e => e.code === JOLTS_CODE));
        const rows = joltsSchedule(await getBlsText(o.fetch,JOLTS_SCHEDULE_URL));
        await o.db.upsertEvents(rows);
        if (!rows.some(e => Date.parse(e.starts_at)>o.now)) throw new Error("BLS JOLTS schedule: official future horizon exhausted; existing events retained");
        return rows.length;
      });
    });
    await isolated("bls-jolts-history", async () => {
      const last = await o.db.lastRun("bls-jolts-history");
      if (last !== null && new Date(last).toISOString().slice(0,10) === new Date(o.now).toISOString().slice(0,10)) return;
      await run("bls-jolts-history", async () => {
        const legacy = (await o.db.releasedFigures(o.now - 120 * DAY)).filter(e => e.code === JOLTS_CODE && e.actual && !verifiedJoltsMeta(e.reference_period,e.result_meta));
        if (legacy.length) throw new Error(`JOLTS: legacy values preserved; initial provenance unverified for ${legacy.map(e=>e.id).join(", ")}`);
        return 0;
      });
    });
    await run("bea-schedule", async () => {
      const body = await get(o.fetch, FEEDS.beaIcs);
      const rows = beaSchedule(body, o.now);
      await o.db.cancelEvents(icsCancellations(body).map((e) => ({ source: "bea", source_uid: e.uid, schedule_meta: e.meta })));
      await o.db.upsertEvents(rows);
      return rows.length;
    });
    await run("eurostat-schedule", async () => {
      const body = await get(o.fetch, eurostatCalendarUrl(o.now));
      const rows = eurostatSchedule(body, o.now);
      await o.db.cancelEvents(icsCancellations(body).map((e) => ({ source: "eurostat", source_uid: e.uid, schedule_meta: e.meta })));
      await o.db.upsertEvents(rows);
      return rows.length;
    });
    await ons;
    await previousValues(o, run);
  }

  const onsBudget = o.onsBudget;
  const fastOns = o.scope === "news" && onsBudget
    ? isolated("ons-gdp-fast", async () => {
      const candidates = await onsBudget.due(o.now);
      if (candidates.length) await run("ons-gdp-fast", () => collectOnsFacts(o, candidates, ONS_DETAIL_LIMIT));
    }) : undefined;

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
    const bea = run("bea-releases", async () => {
      const { news, results: figures, issues } = beaReleases(await get(o.fetch, FEEDS.beaRss));
      const rows = dedupe(await linkable(o.db, recent(news, o.now)));
      await o.db.insertNews(rows);
      const known = await o.db.matchResults(figures);
      await o.db.saveResults(known);
      // BEA ids end with the release day: the next release of the same indicator is on a later day
      // BEA stages share periods: no stage-to-stage previous-value carry.
      if (issues.length) throw new Error(Array.from(new Set(issues)).join("; "));
      return rows.length + known.length;
    });
    await Promise.all([bea, o.db.reserveRelease ? isolated("bls-release-check", () => priorityBls(o, run)) : undefined]);
    await isolated("bls-api", () => blsFigures(o, run));
    await isolated("eia-api", () => eiaFigures(o, run));
    await isolated("census-api", () => censusFigures(o, run));
    await isolated("dol-claims", () => dolFigures(o, run));
    await isolated("eurostat-api", () => eurostatFigures(o, run));
  }

  await fastOns;
  const pruned = o.prune ? await o.db.prune() : null;
  return { results, pruned };
}

type SourceOutcome = { items: number; issues: string[] };
type Run = (source: string, job: () => Promise<number | SourceOutcome>) => Promise<void>;
const ONS_DETAIL_LIMIT = 2;

async function collectOnsSchedules(o: CollectOptions, daily?: string | null): Promise<SourceOutcome & { facts?: () => Promise<SourceOutcome> }> {
  const read = async (list: (typeof ONS_LISTS)[number]) => {
    const html = await onsRequest(o, "schedule", list, onsCalendarUrl(list, o.now), daily);
    if (html === null) throw new Error("ONS GDP: schedule request deferred by budget or source pause");
    return onsSchedules(html, list, o.now);
  };
  const lists: EventRow[][] = [];
  if (o.onsBudget) {
    for (const list of ONS_LISTS) lists.push(await read(list));
  } else {
    lists.push(...await Promise.all(ONS_LISTS.map(read)));
  }
  if (!lists[0].some(row => Date.parse(row.starts_at) > o.now)) throw new Error("ONS GDP: confirmed future horizon unavailable");
  const stored = new Map((await o.db.onsSchedules()).map(row => [row.id, row]));
  const rows: EventRow[] = [];
  const issues: string[] = [];
  const found = new Map<string, EventRow>();
  const ambiguous = new Set<string>();
  for (const row of lists.flat()) {
    const other = found.get(row.id);
    if (other && (other.source_uid !== row.source_uid || other.starts_at !== row.starts_at || other.schedule_meta?.cancelled !== row.schedule_meta?.cancelled)) ambiguous.add(row.id);
    else found.set(row.id, row);
  }
  let detailRequests = 0;
  let pauseDetails = false;
  for (const [id, row] of found) {
    if (ambiguous.has(id)) {
      issues.push("ONS GDP: conflicting official listings");
      continue;
    }
    const old = stored.get(id);
    if (!old) {
      if (!row.schedule_meta?.cancelled) rows.push(row);
      continue;
    }
    if (old.source_uid !== row.source_uid) {
      issues.push("ONS GDP: conflicting official release path for the saved period");
      continue;
    }
    const sameTime = Date.parse(old.starts_at) === Date.parse(row.starts_at);
    if (row.schedule_meta?.cancelled) {
      if (old.status === "cancelled") continue;
      if (sameTime && old.status === "scheduled" && old.schedule_meta?.sequence !== undefined) {
        rows.push({ ...row, schedule_meta: { sequence: old.schedule_meta.sequence + 1, cancelled: true } });
      } else issues.push("ONS GDP: cancellation does not match the saved release");
      continue;
    }
    if (sameTime || old.status !== "scheduled") continue;
    if (pauseDetails || detailRequests >= ONS_DETAIL_LIMIT) {
      issues.push("ONS GDP: remaining changes deferred to the next daily run");
      continue;
    }
    detailRequests++;
    try {
      const html = await onsRequest(o, "move", id, row.url!, daily);
      if (html === null) { issues.push("ONS GDP: move deferred by budget or source pause"); continue; }
      const sequence = onsMoveSequence(html, row, old);
      if (sequence === null) issues.push("ONS GDP: date change not verified");
      else rows.push({ ...row, schedule_meta: { sequence, cancelled: false } });
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      pauseDetails = onsBackoff(error);
    }
  }
  await o.db.upsertEvents(rows);
  const budget = pauseDetails ? 0 : ONS_DETAIL_LIMIT - detailRequests;
  const pending = lists[1].filter(row => {
    const old = stored.get(row.id);
    const saved = rows.find(candidate => candidate.id === row.id);
    return !(ambiguous.has(row.id) || old?.status === "released" || old?.status === "cancelled"
      || (old && old.source_uid !== row.source_uid) || Date.parse(row.starts_at) > o.now
      || (!saved && (!old || Date.parse(old.starts_at) !== Date.parse(row.starts_at))));
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { items: rows.length, issues, facts: pending.length && budget ? () => collectOnsFacts(o, pending, budget, daily) : undefined };
}

function onsPause(error: unknown, now: number): string | undefined {
  if (!(error instanceof ReleaseHttpError)) return;
  if (error.status === 403) {
    const nextDaily = Math.floor((now - 5 * HOUR) / DAY + 1) * DAY + 5 * HOUR;
    return new Date(nextDaily).toISOString();
  }
  if (error.status === 429 || error.status === 503) {
    return retryAfterAt(error.retryAfter, now) ?? (error.status === 429 ? new Date(now + HOUR).toISOString() : undefined);
  }
}

async function onsRequest(o: CollectOptions, kind: OnsRequestKind, target: string, url: string, daily?: string | null) {
  const get = () => getOns(o.onsFetch ?? o.fetch, url);
  if (!o.onsBudget) return get();
  return withOnsSlot(o.onsBudget, kind, target, daily, get, onsPause);
}

function onsBackoff(error: unknown): boolean {
  return error instanceof ReleaseHttpError && (error.status === 403 || error.status === 429 || (error.status === 503 && !!error.retryAfter));
}

async function collectOnsFacts(o: CollectOptions, pending: EventRow[], budget: number, daily?: string | null): Promise<SourceOutcome> {
  const issues: string[] = [];
  let items = 0;
  for (const row of pending) {
    if (budget === 0) break;
    const url = onsBulletinUrl(row);
    if (!url) { issues.push(`${row.id}: unsupported dated bulletin path`); continue; }
    try {
      const read = async () => {
        budget--;
        const result = onsGdpResult(await getOns(o.onsFetch ?? o.fetch, url, true), row);
        if (!result) throw new Error(o.onsBudget ? "GET sent; official figure not yet verified in the bulletin" : "published bulletin lacks a verified figure");
        return result;
      };
      if (o.onsBudget) {
        const verified = async () => ({ ...await read(), reference_period: row.reference_period });
        if (!await withOnsSlot(o.onsBudget, "fact", row.id, daily, verified, onsPause, row.starts_at)) {
          issues.push(`${row.id}: verification deferred; no GET sent`);
          continue;
        }
      } else {
        await o.db.saveResults([await read()]);
      }
      items++;
    } catch (error) {
      issues.push(`${row.id}: ${o.onsBudget && error instanceof ReleaseHttpError && error.status === 404
        ? "GET sent; official bulletin not available (HTTP 404)"
        : error instanceof Error ? error.message : String(error)}`);
      if (onsBackoff(error)) break;
    }
  }
  return { items, issues };
}

async function getOns(fetcher: Fetcher, url: string, bulletin = false): Promise<string> {
  const abort = new AbortController();
  try {
    return await withTimeout((async () => {
      const response = await fetcher(url, { headers: { Accept: "text/html", "User-Agent": USER_AGENT }, redirect: "manual", signal: abort.signal });
      if (!response.ok) throw new ReleaseHttpError(response.status, "ONS GDP", response.headers?.get("retry-after"));
      if (bulletin && !/^text\/html(?:\s*;|$)/i.test(response.headers?.get("content-type") ?? "")) {
        throw new Error("ONS GDP: unexpected bulletin content type");
      }
      return response.text();
    })(), 8_000);
  } finally {
    abort.abort();
  }
}

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
async function due(o: CollectOptions, source: string, runName: string, opts: { fastMs: number; slowMs?: number; codes?: readonly string[]; otherRunNames?: string[] }): Promise<WaitingEvent[]> {
  const waiting = (await o.db.waitingEvents(source, o.now - RETRY_DAYS * DAY, o.now)).filter((e) => !opts.codes || (e.code !== null && opts.codes.includes(e.code)));
  if (!waiting.length) return [];
  const every = Math.min(...waiting.map((e) => retryEvery(o.now - Date.parse(e.starts_at), opts.fastMs, opts.slowMs)));
  const runs = await Promise.all([runName, ...opts.otherRunNames || []].map(name => o.db.lastRun(name)));
  const last = runs.reduce<number | null>((a, b) => b === null ? a : a === null ? b : Math.max(a, b), null);
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
async function carryForward(o: CollectOptions, figures: { code: string; actual: string; at: string; period?: string | null }[]): Promise<number> {
  const known = figures.filter((f) => f.actual);
  if (!known.length) return 0;
  const upcoming = await o.db.scheduledEvents(o.now - RETRY_DAYS * DAY, o.now + 120 * DAY);
  const rows: { id: string; previous: string }[] = [];
  for (const code of Array.from(new Set(known.map((f) => f.code)))) {
    const last = known.filter((f) => f.code === code).sort((a, b) => b.at.localeCompare(a.at))[0];
    const next = upcoming.filter((e) => e.code === code && e.starts_at > last.at).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    if (next?.reference_period && last.period === previousPeriod(next.reference_period) && next.previous !== last.actual) rows.push({ id: next.id, previous: last.actual.split(" · ")[0] });
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
    results.filter((r) => r.actual && at.get(r.id)?.code).map((r) => ({ code: at.get(r.id)!.code!, actual: r.actual!, at: at.get(r.id)!.starts_at, period: r.result_meta?.period }))
  );
}

/** BLS: the main releases from the official API (one request asks every series). */
class ReleaseHttpError extends Error {
  constructor(readonly status: number, source: string, readonly retryAfter?: string | null) {
    super(`HTTP ${status} ${source}`);
  }
}
export function retryAfterAt(value: string | null | undefined, now: number): string | undefined {
  const raw = value?.trim();
  if (!raw) return;
  const at = /^\d+$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(raw);
  if (Number.isFinite(at) && at <= 8.64e15) return new Date(Math.max(now, at)).toISOString();
}

async function blsData(o: CollectOptions, singleRequest = false) {
  const abort = new AbortController();
  const body = await withTimeout((async () => {
    const res = await o.fetch(o.blsKey ? BLS_API_V2 : BLS_API_V1, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: blsRequestBody(o.blsKey, new Date(o.now).getUTCFullYear()),
      signal: abort.signal,
      ...(singleRequest ? {redirect:"manual" as const} : {}),
    });
    if (!res.ok) throw new ReleaseHttpError(res.status, "BLS API", res.headers?.get("retry-after"));
    return JSON.parse(await res.text());
  })()).finally(() => abort.abort());
  if (body?.status && body.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API: ${String(body.status)} ${JSON.stringify(body.message ?? "").slice(0, 300)}`);
  return parseBlsResponse(body);
}

async function cpiPrevious(o: CollectOptions, figures: EventResult[], group: WaitingEvent[], period: string) {
  const stored = await o.db.releasedFigures(o.now - 120 * DAY);
  for (const figure of figures) {
    const event = group.find(e => e.id === figure.id)!;
    if (figure.previous !== null) continue;
    const prior = stored.filter(e => e.code === event.code && isCpiCode(e.code) && e.reference_period === previousPeriod(period) && verifiedCpiMeta(e.code, e.reference_period, e.result_meta));
    if (prior.length === 1) figure.previous = prior[0].actual;
  }
}

async function priorityBls(o: CollectOptions, run: Run): Promise<void> {
  const {reserveRelease,finishRelease} = o.db;
  if (!reserveRelease || !finishRelease) return;
  const waiting = await o.db.waitingEvents("bls", o.now - RETRY_DAYS * DAY, o.now);
  const groups = new Map<string, WaitingEvent[]>();
  for (const event of waiting) {
    if ((!isCpiCode(event.code) && event.code !== "us_nfp") || !event.reference_period || event.release_stage !== "regular") continue;
    const key = [event.code === "us_nfp" ? "nfp" : "cpi",event.starts_at,event.reference_period].join(":");
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key,group);
  }
  for (const group of Array.from(groups.values()).sort((a,b)=>b[0].starts_at.localeCompare(a[0].starts_at))) {
    const family = group[0].code === "us_nfp" ? "nfp" : "cpi";
    const token = await reserveRelease(family,group.map(e=>e.id));
    if (!token) continue;
    await run(family === "cpi" ? "bls-cpi-check" : "bls-nfp-check", async () =>{
      const outcome: ReleaseCompletion = {verified:false,results:[],absences:[]};
      let revisions: EventResult[] = [];
      try {
        if (family === "cpi") {
          const day = nyDay(Date.parse(group[0].starts_at));
          const release = parseCpiRelease(await getBlsText(o.fetch,cpiReleaseUrl(day),true),day);
          if (release.period !== group[0].reference_period) throw new Error("CPI: release period mismatch");
          outcome.results = cpiResults(group,release);
          outcome.absences = cpiAbsences(group,release);
          await cpiPrevious(o,outcome.results,group,release.period);
          outcome.verified = true;
        } else {
          const data = await blsData(o,true);
          outcome.results = blsResults(group.map(e=>e.id),data,group);
          outcome.verified = outcome.results.length > 0;
          const older = (await o.db.revisionEvents("bls",o.now-NEWS_DAYS*DAY,o.now)).filter(e=>e.code==="us_nfp");
          revisions = blsResults(older.map(e=>e.id),data,older);
        }
      } catch(error) {
        const status = error instanceof ReleaseHttpError ? error.status : null;
        await finishRelease(token,{verified:false,results:[],absences:[],
          failure:status===403 ? "blocked" : status===429 ? "rate_limited" : status===null || status>=500 ? "transient" : "invalid",
          retryAt:error instanceof ReleaseHttpError && status===429 ? retryAfterAt(error.retryAfter, Date.now()) : undefined});
        throw error;
      }
      await finishRelease(token,outcome);
      if (revisions.length) await o.db.saveResults(revisions);
      await carryForward(o,outcome.results.map(r=>({code:group.find(e=>e.id===r.id)!.code!,actual:r.actual!,at:group[0].starts_at,period:r.result_meta?.period})));
      if (outcome.results.length+outcome.absences.length!==group.length) throw new Error("BLS: some release results remain unconfirmed");
      return outcome.results.length+outcome.absences.length;
    });
    return;
  }
}

async function blsFigures(o: CollectOptions, run: Run) {
  const waiting = await due(o, "bls", "bls-api", { fastMs: BLS_WINDOW_MS, slowMs: o.blsKey ? 30 * 60_000 : HOUR, codes: [...(o.db.reserveRelease ? [] : [...BLS_FIGURE_CODES,...Object.keys(CPI_METRICS)]), ...Object.keys(PPI_METRICS), JOLTS_CODE], otherRunNames: ["bls-cpi-release", "bls-ppi-release", "bls-jolts-release"] });
  if (!waiting.length) return;
  const cpi = waiting.filter(e => isCpiCode(e.code));
  const ppi = waiting.filter(e => isPpiCode(e.code));
  const jolts = waiting.filter(e => e.code === JOLTS_CODE);
  const api = waiting.filter(e => !isCpiCode(e.code) && !isPpiCode(e.code) && e.code !== JOLTS_CODE);
  // One upstream request per existing BLS slot, including mixed-release days and failed retries.
  const slots = await Promise.all([{name:"bls-cpi-release",rows:cpi},{name:"bls-ppi-release",rows:ppi},{name:"bls-api",rows:api},{name:"bls-jolts-release",rows:jolts}].filter(s => s.rows.length).map(async s => ({...s,last:await o.db.lastRun(s.name)})));
  const chosen = slots.sort((a,b) => (a.last ?? -Infinity) - (b.last ?? -Infinity))[0].name;
  if (chosen === "bls-cpi-release") {
    await run("bls-cpi-release", async () => {
      const day = nyDay(Date.parse(cpi.slice().sort((a,b) => a.starts_at.localeCompare(b.starts_at))[0].starts_at));
      const group = cpi.filter(e => nyDay(Date.parse(e.starts_at)) === day);
      const release = parseCpiRelease(await get(o.fetch, cpiReleaseUrl(day)), day);
      const figures = cpiResults(group, release);
      await cpiPrevious(o, figures, group, release.period);
      await save(o, figures, group);
      if (figures.length !== group.length) throw new Error("CPI: confirmed release period or published values unavailable for some events");
      return figures.length;
    });
    return;
  }
  if (chosen === "bls-ppi-release") {
    await run(chosen, async () => {
      const day = nyDay(Date.parse(ppi.slice().sort((a,b) => a.starts_at.localeCompare(b.starts_at))[0].starts_at));
      const group = ppi.filter(e => nyDay(Date.parse(e.starts_at)) === day);
      const release = parsePpiRelease(await getBlsText(o.fetch, ppiReleaseUrl(day)), day);
      const figures = ppiResults(group,release);
      const stored = await o.db.releasedFigures(o.now - 120 * DAY);
      for (const figure of figures) {
        const event = group.find(e => e.id === figure.id)!;
        if (event.code !== "us_core_ppi_yoy" || figure.previous !== null) continue;
        const prior = stored.filter(e => e.code === event.code && isPpiCode(e.code) && e.reference_period === previousPeriod(release.period) && verifiedPpiMeta(e.code,e.reference_period,e.result_meta));
        if (prior.length === 1) {
          figure.previous = prior[0].actual;
          figure.result_meta!.previous_source = {period: prior[0].reference_period!, release_url: prior[0].result_meta!.release_url!, source_updated: prior[0].result_meta!.source_updated!, basis:"initial-prior-release"};
        }
      }
      await save(o,figures,group);
      if (figures.length !== group.length) throw new Error("PPI: confirmed release period/published values unavailable for some events");
      return figures.length;
    });
    return;
  }
  if (chosen === "bls-jolts-release") {
    await run(chosen, async () => {
      const day = nyDay(Date.parse(jolts.slice().sort((a,b)=>a.starts_at.localeCompare(b.starts_at))[0].starts_at));
      const group = jolts.filter(e=>nyDay(Date.parse(e.starts_at))===day);
      const release = parseJoltsRelease(await getBlsText(o.fetch,joltsReleaseUrl(day)),day);
      const figures = joltsResults(group,release);
      if (figures.some(f=>f.previous===null)) {
        const prior = (await o.db.releasedFigures(o.now - 120 * DAY)).filter(e=>e.code===JOLTS_CODE && e.actual && e.reference_period===previousPeriod(release.period) && verifiedJoltsMeta(e.reference_period,e.result_meta));
        if (prior.length===1) for (const f of figures) if (f.previous===null) {
          f.previous=prior[0].actual;
          f.result_meta!.previous_source={period:prior[0].reference_period!,release_url:prior[0].result_meta!.release_url!,source_updated:prior[0].result_meta!.source_updated!,basis:"initial-prior-release"};
        }
      }
      await save(o,figures,group);
      if (figures.length!==group.length) throw new Error("JOLTS: confirmed initial release period/value unavailable");
      return figures.length;
    });
    return;
  }
  await run("bls-api", async () => {
    const candidates = [...api, ...await o.db.revisionEvents("bls", o.now - NEWS_DAYS * DAY, o.now)].filter(e => !isCpiCode(e.code) && !isPpiCode(e.code) && e.code !== JOLTS_CODE);
    const figures = blsResults(candidates.map((e) => e.id), await blsData(o), candidates);
    await save(o, figures, api);
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
    const revisions = await o.db.revisionEvents("eia", o.now - NEWS_DAYS * DAY, o.now);
    for (const code of Array.from(new Set(waiting.map((e) => e.code as EiaCode)))) {
      // the key is in the URL as EIA asks; the error message names the series, never the URL
      const values = parseEia(await json(o, eiaUrl(code, o.eiaKey), `EIA API ${code}`));
      for (const e of [...waiting, ...revisions].filter((x) => x.code === code)) {
        const r = eiaResult(e.id, values, e.reference_period, e.code);
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
    const revisions = await o.db.revisionEvents("census", o.now - NEWS_DAYS * DAY, o.now);
    const missing: string[] = [];
    const errors: string[] = [];
    // each release on its own: one failing never keeps the others' figures from being saved
    for (const e of waiting) {
      const code = e.code as keyof typeof CENSUS_RELEASES;
      const ref = e.reference_period || CENSUS_RELEASES[code]?.dates[e.id.split(":")[2]];
      if (!ref) continue;
      try {
        const data = parseCensus(await fetchCensus(o.fetch, censusUrl(code, ref), o.censusKey, code), CENSUS_SERIES[code].category);
        const r = censusResult(e.id, data, ref, code);
        if (r) out.push(r); else missing.push(`${code} ${ref}`);
        for (const old of revisions.filter((x) => x.code === code && x.reference_period)) {
          const revision = censusResult(old.id, data, old.reference_period, code);
          if (revision) out.push(revision);
        }
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
    const revisions = await o.db.revisionEvents("dol", o.now - NEWS_DAYS * DAY, o.now);
    const out = claimsResult(waiting.map((e) => e.id), await dolRelease(o), [...waiting, ...revisions]);
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
    const revisions = await o.db.revisionEvents("eurostat", o.now - NEWS_DAYS * DAY, o.now);
    // each release on its own (two come out the same morning); one dataset is asked once
    for (const e of waiting) {
      const code = e.code as EurostatCode;
      const url = eurostatUrl(code);
      if (!asked.has(url)) asked.set(url, json(o, url, `Eurostat API ${code}`).then(parseEurostat));
      try {
        const data = await asked.get(url)!;
        const r = eurostatResult(e.id, e.starts_at, data, e.reference_period, e.code);
        if (r) out.push(r);
        else errors.push(`Eurostat ${code}: confirmed period/stage/series unavailable`);
        for (const old of revisions.filter((x) => x.code === code && x.reference_period)) {
          const revision = eurostatResult(old.id, old.starts_at, data, old.reference_period, old.code);
          // Flash/initial estimates are distinct vintages; latest-only API cannot revise those stages faithfully.
          if (revision && !["preliminary", "flash"].includes(old.release_stage || "")) out.push(revision);
        }
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
    for (const f of stored.sort((a, b) => b.starts_at.localeCompare(a.starts_at))) {
      const upcoming = f.code ? next.get(f.code) : null;
      if (f.code && f.actual && (!isCpiCode(f.code) || verifiedCpiMeta(f.code, f.reference_period, f.result_meta)) && (!isPpiCode(f.code) || verifiedPpiMeta(f.code,f.reference_period,f.result_meta)) && (f.code!==JOLTS_CODE || verifiedJoltsMeta(f.reference_period,f.result_meta)) && upcoming?.reference_period && f.reference_period === previousPeriod(upcoming.reference_period) && !latest.has(f.code)) latest.set(f.code, f.actual.split(" · ")[0]);
    }

    // the first time: ask the sources for what they publish now (each on its own: one failing keeps the rest)
    const missing = (codes: readonly string[]) => codes.filter((c) => next.has(c) && next.get(c)!.previous === null && !latest.has(c));
    const errors: string[] = [];
    const tryAsk = async (what: string, job: () => Promise<void>) => {
      try {
        await job();
      } catch (e) {
        errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    if (missing(BLS_FIGURE_CODES).length) await tryAsk("BLS", async () => setAll(latest, blsLatest(await blsData(o), Object.fromEntries(Array.from(next).map(([code,e]) => [code,e.reference_period])))));
    if (o.eiaKey && missing(Object.keys(EIA_SERIES)).length) {
      for (const code of missing(Object.keys(EIA_SERIES)) as EiaCode[]) if (next.get(code)?.reference_period) await tryAsk("EIA", async () => setOne(latest, code, eiaLatest(code, parseEia(await json(o, eiaUrl(code, o.eiaKey!), `EIA API ${code}`)), next.get(code)!.reference_period)));
    }
    for (const code of missing(Object.keys(EUROSTAT_SERIES)) as EurostatCode[]) {
      await tryAsk("Eurostat", async () => setOne(latest, code, eurostatLatest(code, parseEurostat(await json(o, eurostatUrl(code), `Eurostat API ${code}`)), next.get(code)!.starts_at, o.now, next.get(code)!.reference_period)));
    }
    for (const code of missing(Object.keys(CENSUS_RELEASES)) as (keyof typeof CENSUS_RELEASES)[]) {
      const ref = next.get(code)!.reference_period;
      if (ref) await tryAsk("Census", async () => setOne(latest, code, censusLatest(code, ref, parseCensus(await fetchCensus(o.fetch, censusUrl(code, ref), o.censusKey, code), CENSUS_SERIES[code].category))));
    }
    if (missing(["us_jobless_claims"]).length) await tryAsk("DOL", async () => {
      const release = await dolRelease(o);
      if (release.period === previousPeriod(next.get("us_jobless_claims")?.reference_period || "")) setOne(latest, "us_jobless_claims", release.actual);
    });

    const rows = Array.from(next.values())
      .filter((e) => latest.has(e.code!) && e.previous !== latest.get(e.code!))
      .map((e) => ({ id: e.id, previous: latest.get(e.code!)!.split(" · ")[0] }));
    if (rows.length) await o.db.setPrevious(rows);
    if (errors.length) throw new Error(`${rows.length} set; ${Array.from(new Set(errors)).join("; ")}`.slice(0, 1900));
    return rows.length;
  });
}

const setAll = (into: Map<string, string>, from: Map<string, string>) => from.forEach((v, k) => into.has(k) || into.set(k, v));
const setOne = (into: Map<string, string>, code: string, value: string | null) => {
  if (value && !into.has(code)) into.set(code, value);
};
