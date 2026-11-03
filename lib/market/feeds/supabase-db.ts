import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FeedsDb, RunLog } from "./collect";
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
