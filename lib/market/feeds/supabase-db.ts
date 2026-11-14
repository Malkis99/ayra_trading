import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FeedsDb, RunLog, ScheduledEvent, WaitingEvent } from "./collect";
import type { EventResult, EventRow, NewsRow } from "./types";
import type { StoredOnsSchedule } from "./ons-gdp";
import type { OnsBudget } from "./ons-budget";

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

export function supabaseOnsBudget(db: SupabaseClient): OnsBudget {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    check(error, "ONS budget " + name);
    return data;
  }
  return {
    async daily(token, ready) {
      return await rpc("ons_daily", { p_token: token ?? null, p_ready: ready ?? false }) as string | null;
    },
    async due(now) {
      const { data, error } = await db.from("market_events")
        .select("id,source,kind,code,country,title,importance,starts_at,time_tbd,url,source_uid,reference_period,release_stage")
        .eq("source", "ons").eq("country", "gb").eq("kind", "release").eq("status", "scheduled")
        .is("actual", null).eq("time_tbd", false)
        .gte("starts_at", new Date(now - 30 * 60_000).toISOString()).lte("starts_at", new Date(now).toISOString())
        .order("starts_at").order("importance", { ascending: false }).order("id");
      check(error, "ONS due releases");
      return (data ?? []) as EventRow[];
    },
    async reserve(kind, target, daily, expectedStart) {
      return await rpc("ons_reserve_slot", { p_kind: kind, p_target: target, p_daily: daily ?? null,
        p_expected_start: expectedStart ?? null }) as string | null;
    },
    async charge(token) {
      return await rpc("ons_charge_slot", { p_token: token }) === true;
    },
    async finish(token, result, pause) {
      const args = { p_token: token, p_result: result ?? null, p_pause: pause ?? null };
      const outcome = await rpc("ons_finish_slot", args).catch(() => rpc("ons_finish_slot", args));
      if (outcome !== (result ? "saved" : "complete")) throw new Error("ONS verification: " + outcome);
    },
  };
}

const CHUNK = 200;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

export function supabaseFeedsDb(db: SupabaseClient, releaseChecks = false): FeedsDb {
  async function apply(rows: unknown[], mode: string) {
    const conflicts: string[] = [];
    for (const part of chunks(rows)) {
      const { data, error } = await db.rpc("market_events_apply", { p_rows: part, p_mode: mode });
      check(error, "calendar integrity (requires migration 0012)");
      for (const item of (data ?? []) as { conflict?: string }[]) if (item.conflict) conflicts.push(item.conflict);
    }
    if (conflicts.length) throw new Error(`calendar conflict: ${Array.from(new Set(conflicts)).join("; ")}`);
  }
  return {
    ...(releaseChecks ? {
      async reserveRelease(family, ids) {
        const { data, error } = await db.rpc("market_release_reserve", { p_family: family, p_ids: ids });
        check(error, "calendar release reservation");
        return typeof data === "string" ? data : null;
      },
      async finishRelease(token, outcome) {
        const { data, error } = await db.rpc("market_release_finish", {
          p_token: token, p_verified: outcome.verified, p_failure: outcome.failure ?? null,
          p_retry_at: outcome.retryAt ?? null, p_results: outcome.results, p_absences: outcome.absences,
        });
        check(error, "calendar release completion");
        const conflicts = (data ?? []).flatMap((item: { conflict?: string }) => item.conflict ? [item.conflict] : []);
        if (conflicts.length) throw new Error("calendar release conflict: " + conflicts.join("; "));
      },
    } satisfies Pick<FeedsDb, "reserveRelease" | "finishRelease"> : {}),
    async matchResults(rows) {
      const matched: EventResult[] = [];
      for (const r of rows) {
        const [source, code] = r.id.split(":");
        if (!r.reference_period || !r.release_stage) continue;
        const { data, error } = await db.from("market_events").select("id").eq("source", source).eq("country", "us").eq("code", code)
          .eq("reference_period", r.reference_period).eq("release_stage", r.release_stage);
        check(error, "calendar result matching");
        if (data?.length === 1) matched.push({ ...r, id: data[0].id });
        else if (data?.length) throw new Error("calendar conflict: ambiguous publication period/stage");
      }
      return matched;
    },
    async cancelEvents(rows) { await apply(rows, "cancel"); },
    async revisionEvents(source, from, to) {
      const { data, error } = await db.from("market_events").select("id,code,starts_at,reference_period,release_stage").eq("source", source).eq("kind", "release").eq("status", "released")
        .gte("starts_at", new Date(from).toISOString()).lte("starts_at", new Date(to).toISOString());
      check(error, "calendar revisions"); return (data ?? []) as WaitingEvent[];
    },
    async upsertEvents(rows: EventRow[]) {
      await apply(rows, "schedule");
    },
    async onsSchedules() {
      const { data, error } = await db.from("market_events").select("id,source_uid,starts_at,status,schedule_meta")
        .eq("source", "ons").eq("country", "gb").not("source_uid", "is", null);
      check(error, "ONS GDP schedule read");
      return (data ?? []) as StoredOnsSchedule[];
    },
    async saveResults(rows: EventResult[]) {
      await apply(rows, "result");
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
      const query = db
        .from("market_events")
        .select("id,code,starts_at,reference_period,release_stage")
        .eq("source", source)
        .eq("kind", "release")
        .eq("status", "scheduled")
        .gte("starts_at", new Date(from).toISOString())
        .lte("starts_at", new Date(to).toISOString());
      if (releaseChecks) query.is("release_outcome", null);
      const { data, error } = await query;
      check(error, "market_events read");
      return (data ?? []) as WaitingEvent[];
    },
    async scheduledEvents(from: number, to: number) {
      const { data, error } = await db
        .from("market_events")
        .select("id,source,code,starts_at,previous,reference_period,release_stage")
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
        .select("id,source,code,starts_at,actual,reference_period,result_meta")
        .eq("status", "released")
        .not("actual", "is", null)
        .gte("starts_at", new Date(from).toISOString());
      check(error, "market_events read");
      return (data ?? []) as Awaited<ReturnType<FeedsDb["releasedFigures"]>>;
    },
    async setPrevious(rows: { id: string; previous: string }[]) {
      await apply(rows, "previous");
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
