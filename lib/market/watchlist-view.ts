import { categoryOf, INSTRUMENTS, instrumentName, type CategoryId, type InstrumentId } from "./instruments";
import type { Watchlist } from "./watchlist";

export type WatchlistCategory = CategoryId | "all";

/** A projection only: searching/filtering never sorts or writes the canonical list. */
export function visibleWatchlistIds(list: Watchlist, query: string, category: WatchlistCategory, names: Partial<Record<string, string>>, include: (id: InstrumentId) => boolean = () => true): InstrumentId[] {
  const q = query.trim().toLocaleLowerCase();
  return list.ids.filter(id => include(id) && (category === "all" || categoryOf(id) === category)
    && (!q || `${instrumentName(id, names)} ${INSTRUMENTS[id].ticker} ${INSTRUMENTS[id].symbol}`.toLocaleLowerCase().includes(q)));
}

/** Swap visible neighbours in the full array. Hidden instruments keep their exact positions. */
export function moveVisible(list: Watchlist, id: InstrumentId, step: -1 | 1, query: string, category: WatchlistCategory, names: Partial<Record<string, string>>, include?: (id: InstrumentId) => boolean): Watchlist {
  const visible = visibleWatchlistIds(list, query, category, names, include);
  const index = visible.indexOf(id);
  const other = index >= 0 ? visible[index + step] : undefined;
  if (!other) return list;
  const ids = [...list.ids], a = ids.indexOf(id), b = ids.indexOf(other);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  return { ...list, ids };
}
