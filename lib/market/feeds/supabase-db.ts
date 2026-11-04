import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FeedsDb, RunLog, ScheduledEvent, WaitingEvent } from "./collect";
import type { EventResult, EventRow, NewsRow } from "./types";

/**
 * The collector's database access with the service role (server only: the key never reaches a browser).
 * Writes go to the 0009 tables, which browsers can only read.
 */
export function serviceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

const CHUNK = 200;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

export function supabaseFeedsDb(db: SupabaseClient): FeedsDb {
  return {
    async upsertEvents(rows: EventRow[]) {
      for (const part of chunks(rows)) {
        // only the schedule columns are sent, so status, actual, previous, summary and hidden stay as they are
        const { error } = await db.from("market_events").upsert(part, { onConflict: "id" });
        check(error, "market_events upsert");
      }
    },
    async saveResults(rows: EventResult[]) {
      for (const r of rows) {
        const { id, ...fields } = r;
        const { error } = await db.from("market_events").update(fields).eq("id", id);
        check(error, "market_events update");
      }
    },
    async insertNews(rows: NewsRow[]) {
      for (const part of chunks(rows)) {
        const { error } = await db.from("market_news").upsert(part, { onConflict: "id", ignoreDuplicates: true });
        check(error, "market_news insert");
      }
    },
    async existingEventIds(ids: string[]) {
      if (!ids.length) return new Set<string>();
      const { data, error } = await db.from("market_events").select("id").in("id", ids);
      check(error, "market_events read");
      return new Set((data ?? []).map((r: { id: string }) => r.id));
    },
    async releasedEventIds(ids: string[]) {
      if (!ids.length) return new Set<string>();
      const { data, error } = await db.from("market_events").select("id").in("id", ids).eq("status", "released");
      check(error, "market_events read");
      return new Set((data ?? []).map((r: { id: string }) => r.id));
    },
    async waitingEvents(source: string, from: number, to: number) {
      const { data, error } = await db
        .from("market_events")
        .select("id,code,starts_at")
        .eq("source", source)
        .eq("kind", "release")
        .eq("status", "scheduled")
        .gte("starts_at", new Date(from).toISOString())
        .lte("starts_at", new Date(to).toISOString());
      check(error, "market_events read");
      return (data ?? []) as WaitingEvent[];
    },
    async scheduledEvents(from: number, to: number) {
      const { data, error } = await db
        .from("market_events")
        .select("id,source,code,starts_at,previous")
        .eq("status", "scheduled")
        .not("code", "is", null)
        .gte("starts_at", new Date(from).toISOString())
        .lte("starts_at", new Date(to).toISOString());
      check(error, "market_events read");
      return (data ?? []) as ScheduledEvent[];
    },
    async releasedFigures(from: number) {
      const { data, error } = await db
        .from("market_events")
        .select("id,source,code,starts_at,actual")
        .eq("status", "released")
        .not("actual", "is", null)
        .gte("starts_at", new Date(from).toISOString());
      check(error, "market_events read");
      return (data ?? []) as { id: string; source: string; code: string | null; starts_at: string; actual: string | null }[];
    },
    async setPrevious(rows: { id: string; previous: string }[]) {
      for (const r of rows) {
        // only a scheduled event: a published release keeps the source's own «previous»
        const { error } = await db.from("market_events").update({ previous: r.previous }).eq("id", r.id).eq("status", "scheduled");
        check(error, "market_events update");
      }
    },
    async lastRun(source: string) {
      const { data, error } = await db.from("market_feed_runs").select("started_at").eq("source", source).order("started_at", { ascending: false }).limit(1);
      check(error, "market_feed_runs read");
      const at = (data?.[0] as { started_at?: string } | undefined)?.started_at;
      return at ? Date.parse(at) : null;
    },
    async logRun(run: RunLog) {
      const { error } = await db.from("market_feed_runs").insert(run);
      check(error, "market_feed_runs insert");
    },
    async prune() {
      const { data, error } = await db.rpc("market_feeds_prune");
      check(error, "market_feeds_prune");
      return typeof data === "number" ? data : 0;
    },
  };
}
