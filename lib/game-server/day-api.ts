/**
 * Q4.4 — the server game day API (docs/q4-4-server-day-api.md): open/read the day, change the mode, accept, put off,
 * replace an extra, save the trading days. Behind app/api/game/day/** routes.
 *
 * The user comes ONLY from the verified Supabase session; the body never names a user, a day, a time or (on opening)
 * a mode — such fields refuse the whole request. Every change is made by the 0015/0016 functions with server time.
 * Errors are codes; the database's own messages never leave the server. Kept apart from Next.js for the tests.
 */
import type { RateLimiter } from "./rate-limit";

/** The switch: off unless the owner sets it (the routes answer 404 and the app keeps its local economy). */
export const serverEconomyEnabled = () => process.env.NEXT_PUBLIC_AYRA_SERVER_ECONOMY === "1";

/** PLACEHOLDER: 60 day requests a minute per account and server instance. */
export const DAY_API_RATE = { limit: 60, windowMs: 60_000 };
export const DAY_API_MAX_BODY_BYTES = 2 * 1024;

export type DayAction = "status" | "open" | "mode" | "accept" | "pass" | "replace" | "trading-days";
export const DAY_ACTIONS: readonly DayAction[] = ["status", "open", "mode", "accept", "pass", "replace", "trading-days"];

export interface RpcError {
  code?: string;
  message?: string;
}
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;

export interface DayApiDeps {
  enabled: boolean;
  getUser(): Promise<{ id: string } | null>;
  /** Calls a database function with the service role (the user id is added by the handler, never by the client). */
  rpc: Rpc;
  limiter: RateLimiter;
  now(): Date;
  origin: string | null;
}

export interface ApiHttp {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const NO_STORE = { "Cache-Control": "no-store" };
export const reply = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): ApiHttp => ({ status, body, headers: { ...NO_STORE, ...headers } });

/** Why the server refused (codes from 0014–0016; anything else is a bare server error). */
export const REFUSALS: Record<string, number> = {
  game_account_not_active: 409,
  game_profile_missing: 409,
  game_day_not_open: 409,
  game_day_rest: 409,
  game_day_closed: 409,
  game_mission_not_assigned: 409,
  game_mission_not_accepted: 409,
  game_mission_paid: 409,
  game_not_replaceable: 409,
  game_not_offered: 409,
  game_replacement_limit: 409,
  game_bad_extras: 400,
  game_bad_request: 400,
  game_kind_disabled: 409,
  game_kind_not_implemented: 409,
  game_sync_paused: 409,
  game_evidence_required: 409,
  game_evidence_missing: 409,
  game_evidence_changed: 409,
  game_evidence_type: 409,
  game_source_used: 409,
  game_day_cap: 409,
  game_unknown_mission: 400,
};

/** A database error as a code: a known refusal, «the server economy is not installed», or a bare server error. */
export function refusalOf(error: RpcError): { status: number; reason: string } {
  const msg = (error.message || "").trim();
  if (Object.prototype.hasOwnProperty.call(REFUSALS, msg)) return { status: REFUSALS[msg], reason: msg.replace(/^game_/, "") };
  // PostgREST: function not found (PGRST202) / not in the schema; Postgres: undefined function (42883) or table (42P01)
  if (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42883" || error.code === "42P01" || /could not find the function/i.test(msg)) {
    return { status: 503, reason: "server_economy_unavailable" };
  }
  return { status: 503, reason: "server_error" };
}

const MISSION_RE = /^[a-z0-9_]{2,40}$/;
const isStrList = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && MISSION_RE.test(x));

/** Strict bodies: only the fields of the action. A user id, a day, a time or an opening mode refuse the request. */
export function parseDayBody(action: DayAction, body: unknown): { ok: true; args: Record<string, unknown> } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  const only = (...keys: string[]) => Object.keys(b).every((k) => keys.includes(k));
  switch (action) {
    case "open":
      if (!only("extras") || (b.extras !== undefined && !isStrList(b.extras, 2))) return { ok: false };
      return { ok: true, args: { p_bonus: (b.extras as string[] | undefined) ?? [] } };
    case "mode":
      if (!only("mode", "extras") || !["trading", "study", "recovery", "rest"].includes(b.mode as string) || (b.extras !== undefined && !isStrList(b.extras, 2))) return { ok: false };
      return { ok: true, args: { p_mode: b.mode, p_bonus: (b.extras as string[] | undefined) ?? null } };
    case "accept":
    case "pass":
      if (!only("mission") || typeof b.mission !== "string" || !MISSION_RE.test(b.mission)) return { ok: false };
      return { ok: true, args: { p_mission: b.mission } };
    case "replace":
      if (!only("from", "to") || typeof b.from !== "string" || typeof b.to !== "string" || !MISSION_RE.test(b.from) || !MISSION_RE.test(b.to)) return { ok: false };
      return { ok: true, args: { p_from: b.from, p_to: b.to } };
    case "trading-days": {
      const d = b.days;
      if (!only("days") || !Array.isArray(d) || d.length === 0 || d.length > 7 || !d.every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 6)) return { ok: false };
      return { ok: true, args: { p_days: Array.from(new Set(d as number[])).sort() } };
    }
    default:
      return { ok: false };
  }
}

const FN: Record<Exclude<DayAction, "status">, string> = {
  open: "game_day_open",
  mode: "game_day_set_mode",
  accept: "game_day_accept",
  pass: "game_day_pass",
  replace: "game_day_replace",
  "trading-days": "game_set_trading_days",
};

/** Common gate: switch, method, origin, content type, session, rate limit. Returns the user or a refusal. */
export async function gate(req: Request, deps: Pick<DayApiDeps, "enabled" | "getUser" | "limiter" | "now" | "origin">, allowGet: boolean): Promise<{ user: { id: string } } | { refused: ApiHttp }> {
  if (!deps.enabled) return { refused: reply(404, { error: "server_economy_disabled" }) };
  const isGet = req.method === "GET";
  if (!(req.method === "POST" || (allowGet && isGet))) return { refused: reply(405, { error: "method_not_allowed" }, { Allow: allowGet ? "GET, POST" : "POST" }) };
  if (!isGet) {
    const origin = req.headers.get("origin");
    if (!origin || !deps.origin || origin !== deps.origin) return { refused: reply(403, { error: "cross_origin" }) };
    if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return { refused: reply(415, { error: "bad_content_type" }) };
  }
  let user: { id: string } | null = null;
  try {
    user = await deps.getUser();
  } catch {
    user = null;
  }
  if (!user) return { refused: reply(401, { error: "not_signed_in" }) };
  const limit = deps.limiter.take(user.id, deps.now().getTime());
  if (!limit.ok) return { refused: reply(429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfterSec) }) };
  return { user };
}

export async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; http: ApiHttp }> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, http: reply(413, { error: "too_large" }) };
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, http: reply(400, { error: "bad_request" }) };
  }
}

async function status(deps: DayApiDeps, userId: string): Promise<ApiHttp> {
  const { data, error } = await deps.rpc("game_day_status", { p_user: userId });
  if (error) {
    const r = refusalOf(error);
    return reply(r.status, { error: r.reason });
  }
  return reply(200, { status: data as Record<string, unknown> });
}

/** One request of the day API. */
export async function handleDayApi(req: Request, action: string, deps: DayApiDeps): Promise<ApiHttp> {
  if (!(DAY_ACTIONS as readonly string[]).includes(action)) return reply(404, { error: "unknown_action" });
  const a = action as DayAction;
  const g = await gate(req, deps, a === "status");
  if ("refused" in g) return g.refused;
  if (a === "status") {
    if (req.method !== "GET") return reply(405, { error: "method_not_allowed" }, { Allow: "GET" });
    try {
      return await status(deps, g.user.id);
    } catch {
      return reply(503, { error: "server_error" });
    }
  }
  const json = await readJson(req, DAY_API_MAX_BODY_BYTES);
  if (!json.ok) return json.http;
  const parsed = parseDayBody(a, json.body);
  if (!parsed.ok) return reply(400, { error: "bad_request" });
  try {
    // the user is the session's, always; added here after the body was checked
    const { data, error } = await deps.rpc(FN[a], { p_user: g.user.id, ...parsed.args });
    if (error) {
      const r = refusalOf(error);
      return reply(r.status, { error: r.reason });
    }
    const after = await status(deps, g.user.id);
    return reply(200, { result: data as Record<string, unknown>, ...(after.status === 200 ? after.body : {}) });
  } catch {
    return reply(503, { error: "server_error" });
  }
}
