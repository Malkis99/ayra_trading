import { isInstrumentId, type InstrumentId } from "./instruments";
import { normalizeWatchlist, WATCHLIST_LIMIT, type Watchlist } from "./watchlist";
import { normalizeChartView, normalizeNotes, type ChartNotes, type ChartView, type InstrumentNote } from "./chart-workspace";

/**
 * Market data in the account (owner 2026-11-02; migration 0008, the same approach as the journal, 0004):
 * the Watchlist, notes per instrument and the chart view go to the table `market_user_data`, one row per item —
 * `watchlist`, `chart_view`, `note:<instrument>`. The newest change wins (by its `updatedAt`, here and on the server).
 * The first time an account syncs on a device, the device's Watchlist and the cloud one are joined without
 * duplicates, so nothing kept locally is lost. Pure functions here; the exchange is in `cloud-sync-engine.ts`.
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
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
/** Is `a` newer than `b`? Equal times keep the cloud version (nothing to send). */
const newer = (a: string | undefined, b: string | undefined) => time(a) > time(b);

export function decodeRows(rows: MarketCloudRow[]): { watchlist?: Watchlist; view?: ChartView; notes: ChartNotes } {
  const out: { watchlist?: Watchlist; view?: ChartView; notes: ChartNotes } = { notes: {} };
  for (const row of rows) {
    if (row.id === WATCHLIST_ROW) out.watchlist = normalizeWatchlist(row.data);
    else if (row.id === VIEW_ROW) out.view = normalizeChartView(row.data);
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
  changed: { watchlist: boolean; view: boolean; notes: boolean };
}

/** Merges the device and the cloud: the newest change wins; the first time, the Watchlists are joined. */
export function mergeMarket(local: MarketLocal, rows: MarketCloudRow[], firstSync: boolean, now: Date): MergeResult {
  const cloud = decodeRows(rows);
  const push: MarketCloudRow[] = [];
  const changed = { watchlist: false, view: false, notes: false };

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

  // Chart view
  let view = local.view;
  if (cloud.view && !newer(local.view.updatedAt, cloud.view.updatedAt)) {
    changed.view = JSON.stringify(cloud.view) !== JSON.stringify(local.view);
    view = cloud.view;
  } else if (local.view.updatedAt && (!cloud.view || newer(local.view.updatedAt, cloud.view.updatedAt))) {
    push.push({ id: VIEW_ROW, data: { ...local.view, id: VIEW_ROW } });
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

  return { local: { watchlist, view, notes }, push, changed };
}

function noteRow(id: InstrumentId, note: InstrumentNote): Record<string, unknown> {
  return { id: `${NOTE_PREFIX}${id}`, text: note.text, updatedAt: note.updatedAt, ...(note.deletedAt ? { deletedAt: note.deletedAt } : {}) };
}
