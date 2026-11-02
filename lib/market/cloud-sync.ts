import { isInstrumentId, type InstrumentId } from "./instruments";
import { normalizeChartPrefs, normalizeWatchlist, sameSharedPrefs, sharedPrefs, WATCHLIST_LIMIT, type ChartPrefs, type SharedChartPrefs, type Watchlist } from "./watchlist";
import { normalizeChartView, normalizeNotes, type ChartNotes, type ChartView, type InstrumentNote } from "./chart-workspace";

/**
 * Market data in the account (owner 2026-11-02; migration 0008, the same approach as the journal, 0004):
 * the Watchlist, notes per instrument and the chart view go to the table `market_user_data`, one row per item —
 * `watchlist`, `chart_view`, `note:<instrument>`. The newest change wins (by its `updatedAt`, here and on the server).
 * The first time an account syncs on a device, the device's Watchlist and the cloud one are joined without
 * duplicates, so nothing kept locally is lost. Pure functions here; the exchange is in `cloud-sync-engine.ts`.
 *
 * The `chart_view` row also carries the chart settings that follow the account — favourite timeframes, chart type,
 * indicators, the layout (owner 2026-11-02) — under `chart`, with their own change time: the view and those settings
 * merge separately, so a change of one never undoes the other. No new migration: the row keeps its id.
 */

export const WATCHLIST_ROW = "watchlist";
export const VIEW_ROW = "chart_view";
export const NOTE_PREFIX = "note:";

export interface MarketCloudRow {
  id: string;
  data: Record<string, unknown>;
}

/** What the Market keeps that goes to the account. */
export interface MarketLocal {
  watchlist: Watchlist;
  view: ChartView;
  notes: ChartNotes;
  /** The chart settings; only their shared part (`sharedPrefs`) goes to the account. */
  prefs: ChartPrefs;
}

type SharedInCloud = SharedChartPrefs & { updatedAt: string };

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
/** Is `a` newer than `b`? Equal times keep the cloud version (nothing to send). */
const newer = (a: string | undefined, b: string | undefined) => time(a) > time(b);

export function decodeRows(rows: MarketCloudRow[]): { watchlist?: Watchlist; view?: ChartView; chart?: SharedInCloud; notes: ChartNotes } {
  const out: { watchlist?: Watchlist; view?: ChartView; chart?: SharedInCloud; notes: ChartNotes } = { notes: {} };
  for (const row of rows) {
    if (row.id === WATCHLIST_ROW) out.watchlist = normalizeWatchlist(row.data);
    else if (row.id === VIEW_ROW) {
      // the view's own time (rows written before the chart settings joined have only `updatedAt`)
      const viewAt = typeof row.data.viewUpdatedAt === "string" ? row.data.viewUpdatedAt : row.data.updatedAt;
      out.view = normalizeChartView({ ...row.data, updatedAt: viewAt });
      const chart = row.data.chart as Record<string, unknown> | undefined;
      if (chart && typeof chart === "object" && typeof chart.updatedAt === "string") {
        out.chart = { ...sharedPrefs(normalizeChartPrefs(chart)), updatedAt: chart.updatedAt };
      }
    }
    else if (row.id.startsWith(NOTE_PREFIX)) {
      const id = row.id.slice(NOTE_PREFIX.length);
      if (isInstrumentId(id)) Object.assign(out.notes, normalizeNotes({ [id]: row.data }));
    }
  }
  return out;
}

/** The first sync on a device: the cloud list first, then what only this device had; at most the limit. */
export function joinWatchlists(cloud: Watchlist, local: Watchlist, now: Date): Watchlist {
  const ids: InstrumentId[] = [...cloud.ids];
  for (const id of local.ids) if (!ids.includes(id) && ids.length < WATCHLIST_LIMIT) ids.push(id);
  const same = ids.length === cloud.ids.length;
  return { version: 1, ids, updatedAt: same ? cloud.updatedAt : now.toISOString() };
}

export interface MergeResult {
  local: MarketLocal;
  /** Rows to send: the local version is newer than the cloud one, or the cloud has none. */
  push: MarketCloudRow[];
  /** Did the device's data change (another device's changes came in)? */
  changed: { watchlist: boolean; view: boolean; notes: boolean; prefs: boolean };
}

/** Merges the device and the cloud: the newest change wins; the first time, the Watchlists are joined. */
export function mergeMarket(local: MarketLocal, rows: MarketCloudRow[], firstSync: boolean, now: Date): MergeResult {
  const cloud = decodeRows(rows);
  const push: MarketCloudRow[] = [];
  const changed = { watchlist: false, view: false, notes: false, prefs: false };

  // Watchlist
  let watchlist = local.watchlist;
  if (cloud.watchlist && firstSync) {
    const joined = joinWatchlists(cloud.watchlist, local.watchlist, now);
    watchlist = joined;
    changed.watchlist = joined.ids.join() !== local.watchlist.ids.join();
  } else if (cloud.watchlist && !newer(local.watchlist.updatedAt, cloud.watchlist.updatedAt)) {
    watchlist = cloud.watchlist;
    changed.watchlist = cloud.watchlist.ids.join() !== local.watchlist.ids.join() || cloud.watchlist.updatedAt !== local.watchlist.updatedAt;
  }
  if (!cloud.watchlist ? watchlist.updatedAt || watchlist.ids.length : newer(watchlist.updatedAt, cloud.watchlist.updatedAt)) {
    const stamped = watchlist.updatedAt ? watchlist : { ...watchlist, updatedAt: now.toISOString() };
    watchlist = stamped;
    push.push({ id: WATCHLIST_ROW, data: { id: WATCHLIST_ROW, ids: stamped.ids, updatedAt: stamped.updatedAt } });
  }

  // Chart view and the chart settings: one row, two parts, each with its own time
  let view = local.view;
  let viewPush = false;
  if (cloud.view && !newer(local.view.updatedAt, cloud.view.updatedAt)) {
    changed.view = JSON.stringify(cloud.view) !== JSON.stringify(local.view);
    view = cloud.view;
  } else if (local.view.updatedAt && (!cloud.view || newer(local.view.updatedAt, cloud.view.updatedAt))) {
    viewPush = true;
  }
  let prefs = local.prefs;
  let prefsPush = false;
  if (cloud.chart && !newer(local.prefs.sharedUpdatedAt, cloud.chart.updatedAt)) {
    const { updatedAt, ...shared } = cloud.chart;
    // the instrument and window 1's timeframe stay this device's
    const next: ChartPrefs = { ...local.prefs, ...shared, sharedUpdatedAt: updatedAt };
    changed.prefs = !sameSharedPrefs(local.prefs, next) || local.prefs.sharedUpdatedAt !== updatedAt;
    prefs = next;
  } else if (local.prefs.sharedUpdatedAt && (!cloud.chart || newer(local.prefs.sharedUpdatedAt, cloud.chart.updatedAt))) {
    prefsPush = true;
  }
  if (viewPush || prefsPush) {
    const { updatedAt: viewAt, ...viewFields } = view;
    const at = [viewAt, prefs.sharedUpdatedAt].filter((x): x is string => !!x).sort((a, b) => time(b) - time(a))[0];
    push.push({
      id: VIEW_ROW,
      data: {
        ...viewFields,
        id: VIEW_ROW,
        updatedAt: at,
        ...(viewAt ? { viewUpdatedAt: viewAt } : {}),
        ...(prefs.sharedUpdatedAt ? { chart: { ...sharedPrefs(prefs), updatedAt: prefs.sharedUpdatedAt } } : {}),
      },
    });
  }

  // Notes, one by one (a cleared note is a tombstone and wins like any change)
  const notes: ChartNotes = { ...local.notes };
  const ids = new Set([...Object.keys(local.notes), ...Object.keys(cloud.notes)]) as Set<InstrumentId>;
  for (const id of ids) {
    const mine = local.notes[id];
    const theirs = cloud.notes[id];
    if (theirs && (!mine || !newer(mine.updatedAt, theirs.updatedAt))) {
      if (!mine || mine.updatedAt !== theirs.updatedAt || mine.text !== theirs.text || mine.deletedAt !== theirs.deletedAt) changed.notes = true;
      notes[id] = theirs;
    } else if (mine && (!theirs || newer(mine.updatedAt, theirs.updatedAt))) {
      push.push({ id: `${NOTE_PREFIX}${id}`, data: noteRow(id, mine) });
    }
  }

  return { local: { watchlist, view, notes, prefs }, push, changed };
}

function noteRow(id: InstrumentId, note: InstrumentNote): Record<string, unknown> {
  return { id: `${NOTE_PREFIX}${id}`, text: note.text, updatedAt: note.updatedAt, ...(note.deletedAt ? { deletedAt: note.deletedAt } : {}) };
}
