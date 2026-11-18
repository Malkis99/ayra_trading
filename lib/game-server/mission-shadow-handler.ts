/**
 * Q4.2 — the shadow mission check behind POST /api/game/missions/shadow (docs/q4-2-mission-shadow.md).
 *
 * Read-only: it reads the signed-in user's own cloud journal with the user's own session (row-level security, no service
 * key) and answers what the server would confirm. It writes nothing anywhere and never pays: every answer carries
 * `authorizedForPayout: false`. Kept apart from the Next.js route so the tests can run it with a fake journal.
 */
import { JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS } from "@/lib/journal/cloud/config";
import { CURRENT_JOURNAL_SCHEMA_VERSION } from "@/lib/journal/repository";
import { addDaysToKey } from "@/lib/day-key";
import { evidenceOf, evidenceStable, parseShadowRequest, serverGameDay, serverZone, shadowValidate, type CloudRow, type ShadowTable } from "@/lib/missions-shadow";
import { SHADOW_FP_ALGO, recordFingerprint } from "./fingerprint";
import type { RateLimiter } from "./rate-limit";

/** PLACEHOLDER (owner decision): 20 checks a minute per account and server instance. */
export const SHADOW_RATE = { limit: 20, windowMs: 60_000 };
/** PLACEHOLDER: the largest request body and the most rows read per table (5 pages of 1000). */
export const SHADOW_MAX_BODY_BYTES = 8 * 1024;
export const SHADOW_MAX_ROWS = 5000;

/** The switch (off unless the owner sets it): the app does not call the check and the route answers 404. */
export const missionShadowEnabled = () => process.env.NEXT_PUBLIC_AYRA_MISSION_SHADOW === "1";

/** What the handler reads. The real one goes through the user's Supabase session; the tests give a fake one. */
export interface ShadowJournalReader {
  /** profiles.timezone of the signed-in user (null when there is none). */
  timezone(): Promise<string | null>;
  /** user_features.cloud_sync of the signed-in user. */
  cloudSync(): Promise<boolean>;
  /** Every row of the table (deleted ones included), at most `max`; more → "tooMany". */
  allRows(table: ShadowTable, max: number): Promise<CloudRow[] | "tooMany">;
  /** The rows with these ids. */
  rowsById(table: ShadowTable, ids: string[]): Promise<CloudRow[]>;
}

export interface ShadowDeps {
  enabled: boolean;
  /** The user from the verified session (supabase.auth.getUser on the server), or null. */
  getUser(): Promise<{ id: string } | null>;
  reader: ShadowJournalReader;
  limiter: RateLimiter;
  now(): Date;
  /** The site's own origin (same-origin requests only). */
  origin: string | null;
}

export interface ShadowHttp {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): ShadowHttp => ({ status, body, headers: { ...NO_STORE, ...headers } });

/** Errors never carry the database's message, the user id or record content: a code only. */
export async function handleMissionShadow(req: Request, deps: ShadowDeps): Promise<ShadowHttp> {
  if (!deps.enabled) return reply(404, { error: "shadow_disabled" });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, { Allow: "POST" });
  // same-origin only: another site cannot spend the user's limit with the user's cookies
  const origin = req.headers.get("origin");
  if (!origin || !deps.origin || origin !== deps.origin) return reply(403, { error: "cross_origin" });
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return reply(415, { error: "bad_content_type" });

  let user: { id: string } | null = null;
  try {
    user = await deps.getUser();
  } catch {
    user = null;
  }
  if (!user) return reply(401, { error: "not_signed_in" });

  const limit = deps.limiter.take(user.id, deps.now().getTime());
  if (!limit.ok) return reply(429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfterSec) });

  const text = await req.text();
  if (new TextEncoder().encode(text).length > SHADOW_MAX_BODY_BYTES) return reply(413, { error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "bad_request" });
  }
  const parsed = parseShadowRequest(body);
  if (!parsed.ok) return reply(400, { error: "bad_request" });

  try {
    if (!(await deps.reader.cloudSync())) return reply(409, { error: "cloud_journal_off" });
    const timezone = await deps.reader.timezone();
    const now = deps.now();
    const day = serverGameDay(now, serverZone(timezone).zone);
    const [notes, trades, plans] = await Promise.all([
      deps.reader.allRows("journal_notes", SHADOW_MAX_ROWS),
      deps.reader.allRows("journal_trades", SHADOW_MAX_ROWS),
      deps.reader.rowsById("journal_day_plans", [day, addDaysToKey(day, 1)]),
    ]);
    if (notes === "tooMany" || trades === "tooMany") return reply(422, { error: "journal_too_large" });

    const result = shadowValidate({
      now,
      timezone,
      journal: { notes, trades, plans },
      request: parsed.request,
      fingerprint: recordFingerprint,
      fpAlgo: SHADOW_FP_ALGO,
      schemaVersion: CURRENT_JOURNAL_SCHEMA_VERSION,
      skewMs: JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS,
    });

    // re-read the evidence: a record changed or deleted during the check makes the answer stale
    const evidence = evidenceOf(result);
    if (evidence.length > 0) {
      const after = new Map<string, CloudRow>();
      const byTable = new Map<ShadowTable, string[]>();
      for (const e of evidence) byTable.set(e.table, [...(byTable.get(e.table) || []), e.id]);
      for (const [table, ids] of byTable) for (const r of await deps.reader.rowsById(table, Array.from(new Set(ids)))) after.set(`${table}:${r.id}`, r);
      if (!evidenceStable(evidence, after, recordFingerprint)) return reply(409, { error: "evidence_changed" });
    }
    return reply(200, result as unknown as Record<string, unknown>);
  } catch {
    return reply(503, { error: "cloud_journal_unavailable" });
  }
}
