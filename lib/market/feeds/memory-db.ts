import type { FeedsDb, RunLog } from "./collect";
import type { EventResult, EventRow, NewsRow } from "./types";

/**
 * The collector's database in memory, for tests: the same rules as `supabase-db.ts` (a stored figure or the owner's
 * «hidden» survives a schedule refresh; «previous» is set only on scheduled events; stored news is never replaced).
 */
export type StoredEvent = EventRow & Partial<Omit<EventResult, "id" | "status">> & { status: "scheduled" | "released" | "cancelled" };

export function memoryFeedsDb(seed: { events?: EventRow[]; lastRuns?: Record<string, number> } = {}) {
  const events = new Map<string, StoredEvent>((seed.events ?? []).map((r): [string, StoredEvent] => [r.id, { ...r, status: "scheduled" }]));
  const news = new Map<string, NewsRow>();
  const runs: RunLog[] = [];
  const scheduled = (e: StoredEvent) => (e.status ?? "scheduled") === "scheduled";
  const within = (e: StoredEvent, from: number, to: number) => Date.parse(e.starts_at) >= from && Date.parse(e.starts_at) <= to;
  const db: FeedsDb = {
    async upsertEvents(rows) {
      for (const r of rows) events.set(r.id, { status: "scheduled", ...(events.get(r.id) ?? {}), ...r });
    },
    async saveResults(rows) {
      for (const r of rows) {
        const e = events.get(r.id);
        if (e) events.set(r.id, { ...e, ...r });
      }
    },
    async insertNews(rows) {
      for (const r of rows) if (!news.has(r.id)) news.set(r.id, r);
    },
    async existingEventIds(ids) {
      return new Set(ids.filter((i) => events.has(i)));
    },
    async releasedEventIds(ids) {
      return new Set(ids.filter((i) => events.get(i)?.status === "released"));
    },
    async waitingEvents(source, from, to) {
      return Array.from(events.values())
        .filter((e) => e.source === source && e.kind === "release" && scheduled(e) && within(e, from, to))
        .map((e) => ({ id: e.id, code: e.code, starts_at: e.starts_at }));
    },
    async scheduledEvents(from, to) {
      return Array.from(events.values())
        .filter((e) => scheduled(e) && e.code !== null && within(e, from, to))
        .map((e) => ({ id: e.id, source: e.source, code: e.code, starts_at: e.starts_at, previous: e.previous ?? null }));
    },
    async releasedFigures(from) {
      return Array.from(events.values())
        .filter((e) => e.status === "released" && e.actual && Date.parse(e.starts_at) >= from)
        .map((e) => ({ id: e.id, source: e.source, code: e.code, starts_at: e.starts_at, actual: e.actual ?? null }));
    },
    async setPrevious(rows) {
      for (const r of rows) {
        const e = events.get(r.id);
        if (e && scheduled(e)) events.set(r.id, { ...e, previous: r.previous });
      }
    },
    async lastRun(source) {
      const mine = runs.filter((r) => r.source === source).map((r) => Date.parse(r.started_at));
      return mine.length ? Math.max(...mine) : seed.lastRuns?.[source] ?? null;
    },
    async logRun(r) {
      runs.push(r);
    },
    async prune() {
      return 7;
    },
  };
  return { db, events, news, runs };
}
