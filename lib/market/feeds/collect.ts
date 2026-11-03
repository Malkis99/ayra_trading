import type { EventResult, EventRow, NewsRow } from "./types";
import { FEEDS, beaReleases, beaSchedule, ecbPress, fedMonetary, fedSpeeches, whiteHouseActions, whiteHouseNews } from "./sources";
import { listedEvents } from "./schedules";
import { BLS_API_V1, BLS_API_V2, blsRequestBody, blsResults, parseBlsResponse } from "./bls";

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
  /** When this source last ran (ms), for throttling. */
  lastRun(source: string): Promise<number | null>;
  logRun(run: RunLog): Promise<void>;
  prune(): Promise<number>;
}

export interface RunLog {
  source: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  items: number;
  error: string | null;
}

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

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
  const run = async (source: string, job: () => Promise<number>) => {
    const started = Date.now();
    let r: SourceResult;
    try {
      r = { source, ok: true, items: await job(), error: null };
    } catch (e) {
      r = { source, ok: false, items: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) };
    }
    results.push(r);
    try {
      await o.db.logRun({ ...r, started_at: new Date(started).toISOString(), finished_at: new Date().toISOString() });
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
      return rows.length + known.length;
    });
    await blsFigures(o, run);
  }

  const pruned = o.prune ? await o.db.prune() : null;
  return { results, pruned };
}

/** BLS figures: only for releases of the last two hours not yet filled in, at most every ten minutes. */
async function blsFigures(o: CollectOptions, run: (source: string, job: () => Promise<number>) => Promise<void>) {
  const due = listedEvents()
    .filter((e) => e.source === "bls")
    .filter((e) => {
      const at = Date.parse(e.starts_at);
      return at <= o.now && o.now - at <= BLS_WINDOW_MS;
    })
    .map((e) => e.id);
  if (!due.length) return;
  const released = await o.db.releasedEventIds(due);
  const waiting = due.filter((id) => !released.has(id));
  if (!waiting.length) return;
  const last = await o.db.lastRun("bls-api");
  if (last !== null && o.now - last < BLS_EVERY_MS) return;
  await run("bls-api", async () => {
    const res = await withTimeout(
      o.fetch(o.blsKey ? BLS_API_V2 : BLS_API_V1, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: blsRequestBody(o.blsKey, new Date(o.now).getUTCFullYear()),
      })
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} BLS API`);
    const json = JSON.parse(await res.text());
    if (json?.status && json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API: ${String(json.status)} ${JSON.stringify(json.message ?? "").slice(0, 300)}`);
    const figures = blsResults(waiting, parseBlsResponse(json));
    await o.db.saveResults(figures);
    return figures.length;
  });
}
