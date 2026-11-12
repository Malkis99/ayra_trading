import type { FeedsDb, RunLog } from "./collect";
import type { EventResult, EventRow, NewsRow } from "./types";
import { newerSchedule } from "./identity";
import { createHash } from "node:crypto";

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
    async onsSchedules() {
      return Array.from(events.values()).flatMap(e => e.source === "ons" && e.source_uid
        ? [{ id: e.id, source_uid: e.source_uid, starts_at: e.starts_at, status: e.status, schedule_meta: e.schedule_meta ?? null }] : []);
    },
    async matchResults(rows) {
      const out: EventResult[] = [];
      for (const r of rows) {
        const [source, code] = r.id.split(":");
        const found = Array.from(events.values()).filter((e) => e.source === source && e.code === code && e.reference_period === r.reference_period && e.release_stage === r.release_stage && r.reference_period);
        if (found.length > 1) throw new Error("calendar conflict: ambiguous publication period/stage");
        if (found.length === 1) out.push({ ...r, id: found[0].id });
      }
      return out;
    },
    async revisionEvents(source, from, to) {
      return Array.from(events.values()).filter((e) => e.source === source && e.kind === "release" && e.status === "released" && within(e, from, to));
    },
    async cancelEvents(rows) {
      for (const r of rows) {
        const found = Array.from(events.values()).filter((e) => e.source === r.source && e.source_uid === r.source_uid);
        if (found.length !== 1) throw new Error("calendar conflict: ambiguous cancellation UID");
        const e = found[0];
        if (!newerSchedule(r.schedule_meta, e.schedule_meta || {})) throw new Error("calendar conflict: schedule freshness unproven");
        events.set(e.id, { ...e, schedule_meta: { ...e.schedule_meta, ...r.schedule_meta, ...(e.status !== "cancelled" ? { prior_status: e.status } : {}) }, status: "cancelled" });
      }
    },
    async upsertEvents(rows) {
      const errors: string[] = [];
      for (const r of rows) {
        let e = r.identity_key ? Array.from(events.values()).find((e) => e.identity_key === r.identity_key) : events.get(r.id);
        if (!e && r.identity_key) {
          const exact = events.get(r.id);
          if (exact && !exact.identity_key && exact.source === r.source && exact.country === r.country && exact.code === r.code && exact.title === r.title && exact.starts_at === r.starts_at) {
            const duplicates = Array.from(events.values()).filter((e) => e.source === exact.source && e.country === exact.country && e.code === exact.code && e.title === exact.title && e.starts_at === exact.starts_at);
            if (duplicates.length > 1) { errors.push("ambiguous legacy identity"); continue; }
            e = exact;
          } else {
          const legacy = Array.from(events.values()).filter((e) => !e.identity_key && e.source === r.source && e.country === r.country && e.kind === r.kind && e.code === r.code && e.title === r.title);
          if (legacy.length > 1) { errors.push("ambiguous legacy identity"); continue; }
          e = legacy[0];
          }
        }
        if (!e) {
          const id = events.has(r.id) ? `${r.source}:stable:${createHash("md5").update(r.identity_key || r.id).digest("hex")}` : r.id;
          events.set(id, { ...r, id, status: r.schedule_meta?.cancelled ? "cancelled" : "scheduled" }); continue;
        }
        if (e.source !== r.source || e.code !== r.code || e.country !== r.country || (e.reference_period && r.reference_period && e.reference_period !== r.reference_period) || (e.release_stage && e.release_stage !== r.release_stage)) { errors.push("identity components changed"); continue; }
        const meta = r.schedule_meta || {};
        const changed = e.starts_at !== r.starts_at || e.title !== r.title || (meta.cancelled !== undefined && (e.status === "cancelled") !== meta.cancelled);
        if ((changed && !newerSchedule(meta, e.schedule_meta || {})) || newerSchedule(e.schedule_meta || {}, meta)) { errors.push("schedule freshness unproven"); continue; }
        const activeStatus = e.status === "cancelled" ? e.actual != null || e.schedule_meta?.prior_status === "released" ? "released" : "scheduled" : e.status;
        const cancelled = meta.cancelled ?? (e.status === "cancelled");
        events.set(e.id, { ...e, ...r, id: e.id, reference_period: e.reference_period || r.reference_period, schedule_meta: { ...e.schedule_meta, ...meta, ...(cancelled && e.status !== "cancelled" ? { prior_status: e.status } : {}) }, status: cancelled ? "cancelled" : activeStatus });
      }
      if (errors.length) throw new Error(`calendar conflict: ${Array.from(new Set(errors)).join("; ")}`);
    },
    async saveResults(rows) {
      const errors: string[] = [];
      for (const r of rows) {
        const e = events.get(r.id);
        if (!e) continue;
        if (r.actual === null) continue;
        const meta = r.result_meta;
        if (e.status === "cancelled" || !meta || (e.reference_period && e.reference_period !== meta.period)) { errors.push("result provenance missing or mismatched"); continue; }
        const same = (m: typeof meta) => JSON.stringify([m.period, m.series, m.unit, m.adjustment]);
        if (e.result_meta && same(e.result_meta) !== same(meta)) { errors.push("series units or period changed"); continue; }
        const newer = !!meta.source_updated && !!e.result_meta?.source_updated && Date.parse(meta.source_updated) > Date.parse(e.result_meta.source_updated);
        const changed = (e.actual != null && r.actual != null && e.actual !== r.actual) || (e.status === "released" && e.previous != null && r.previous != null && e.previous !== r.previous);
        if ((changed && !newer) || (meta.source_updated && e.result_meta?.source_updated && Date.parse(meta.source_updated) < Date.parse(e.result_meta.source_updated))) { errors.push("result freshness unproven"); continue; }
        events.set(r.id, { ...e, actual: r.actual ?? e.actual, previous: r.previous ?? e.previous, summary: r.summary ?? e.summary, reference_period: e.reference_period || meta.period, result_meta: r.actual != null && !(e.result_meta?.source_updated && !meta.source_updated) ? meta : e.result_meta, status: (r.actual ?? e.actual) != null ? "released" : e.status });
      }
      if (errors.length) throw new Error(`calendar conflict: ${Array.from(new Set(errors)).join("; ")}`);
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
        .map((e) => ({ id: e.id, code: e.code, starts_at: e.starts_at, reference_period: e.reference_period, release_stage: e.release_stage }));
    },
    async scheduledEvents(from, to) {
      return Array.from(events.values())
        .filter((e) => scheduled(e) && e.code !== null && within(e, from, to))
        .map((e) => ({ id: e.id, source: e.source, code: e.code, starts_at: e.starts_at, previous: e.previous ?? null, reference_period: e.reference_period, release_stage: e.release_stage }));
    },
    async releasedFigures(from) {
      return Array.from(events.values())
        .filter((e) => e.status === "released" && e.actual && Date.parse(e.starts_at) >= from)
        .map((e) => ({ id: e.id, source: e.source, code: e.code, starts_at: e.starts_at, actual: e.actual ?? null, reference_period: e.reference_period, result_meta: e.result_meta }));
    },
    async setPrevious(rows) {
      for (const r of rows) {
        const e = events.get(r.id);
        if (e && scheduled(e) && e.previous == null) events.set(r.id, { ...e, previous: r.previous });
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
