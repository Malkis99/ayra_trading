/**
 * Q4.4 — the app's calls to the server game day API (app/api/game/day/**, /api/game/missions/verify). Never throw:
 * a failure (no network, a refusal, the feature off) is an answer with a code, and nothing in the game changes from it.
 *
 * Q4.5-2 — `session_stale` (401): the session is older than the account's economy state (or was ended). The refusal
 * changed nothing on the server. The app refreshes its session ONCE — the new token carries the account's mark, which
 * Q4.5-1 then applies — and repeats the request ONCE. If the refresh fails, the answer keeps the account's state from
 * the refusal (the person's own, from the database), so the device still learns it.
 */
import type { EconomyMode } from "./economy-mode";
import type { RequestScope } from "./economy-scope";
import { createSupabaseBrowserClient } from "./supabase/browser";
export interface ServerDayRow {
  game_day: string;
  status: "open" | "closed";
  mode: "trading" | "study" | "recovery" | "rest";
  mode_before_rest: "trading" | "study" | "recovery" | null;
  study_first: "m_trade_review" | "m_observation";
  core: string[];
  carried: Record<string, string>;
  accepted: Record<string, string>;
  passed: string[];
  bonus: string[];
  replacements: Array<{ from: string; to: string; at: string }>;
  paid: string[];
}

export interface ServerDayStatus {
  state: EconomyMode;
  game_sync: boolean;
  game_day?: string;
  opening_mode?: "trading" | "study";
  trading_days?: number[];
  day: ServerDayRow | null;
  replacements_left?: number;
  day_full?: boolean;
}

/**
 * An answer of the server. `account` is the user the server answered for (it reads the user from the verified token,
 * Q4.5-2): the game applies an answer only to that account's scope (lib/economy-scope.ts).
 */
export type DayCall =
  | { ok: true; status: ServerDayStatus | null; body: Record<string, unknown>; account?: string }
  | { ok: false; error: string; httpStatus?: number; state?: EconomyMode; account?: string };

const STATES: readonly string[] = ["local", "migration_scheduled", "migration_pending", "cloud_active"];

/** Refreshes the app's session (a new token from the auth server). True when a new session was issued. */
export type SessionRefresher = () => Promise<boolean>;
/** PLACEHOLDER: how long a refresh may take before it counts as failed (the auth client retries a failing server). */
export const SESSION_REFRESH_TIMEOUT_MS = 10_000;
export const refreshAppSession: SessionRefresher = async () => {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), SESSION_REFRESH_TIMEOUT_MS); });
    const refreshed = supabase.auth.refreshSession().then(({ data, error }) => !error && !!data.session, () => false);
    return await Promise.race([refreshed, timeout]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Who learns the account's state from a `session_stale` refusal AT ONCE — before any refresh is tried, so a device
 * stops its local rewards even while the auth server is slow or failing (set by the game, lib/game-context.tsx).
 */
type StaleListener = (state: EconomyMode, answeredAccount: string | undefined, scope: RequestScope | null) => void;
let staleListener: StaleListener | null = null;
export function onSessionStale(listener: StaleListener | null): void {
  staleListener = listener;
}

const TIMEOUT_MS = 10_000;

async function once(path: string, method: "GET" | "POST", body: unknown, fetchImpl: typeof fetch): Promise<DayCall> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: ctrl?.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const account = typeof json.account === "string" && json.account ? { account: json.account } : {};
    if (!res.ok) {
      const state = typeof json.state === "string" && STATES.includes(json.state) ? (json.state as EconomyMode) : undefined;
      return { ok: false, error: typeof json.error === "string" ? json.error : "bad_response", httpStatus: res.status, ...(state ? { state } : {}), ...account };
    }
    const status = json.status && typeof json.status === "object" ? (json.status as ServerDayStatus) : null;
    return { ok: true, status, body: json, ...account };
  } catch {
    return { ok: false, error: "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One request made for `scope` (the account it was sent for); on `session_stale` one session refresh and one repeat (the
 * refused request changed nothing). The listener hears the refusal with the account the server named and that scope —
 * it decides whether the answer still belongs anywhere (lib/economy-scope.ts).
 */
export async function callDayApi(path: string, method: "GET" | "POST", body?: unknown, fetchImpl: typeof fetch = fetch, refresh: SessionRefresher = refreshAppSession, listener: StaleListener | null = staleListener, scope: RequestScope | null = null): Promise<DayCall> {
  const first = await once(path, method, body, fetchImpl);
  if (first.ok || first.error !== "session_stale") return first;
  if (first.state && listener) {
    try {
      listener(first.state, first.account, scope);
    } catch {
      /* the listener's failure never changes the answer */
    }
  }
  if (!(await refresh())) return first;
  const again = await once(path, method, body, fetchImpl);
  // still stale after a fresh session: keep what the first refusal said — only about the same account
  return !again.ok && !again.state && first.state && again.account === first.account ? { ...again, state: first.state } : again;
}

/** The calls of the game: each made for the scope (account) it names; `f` replaces fetch in tests. */
export const serverDay = {
  status: (scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/day/status", "GET", undefined, f, undefined, undefined, scope),
  open: (extras: string[], scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/day/open", "POST", { extras }, f, undefined, undefined, scope),
  mode: (mode: string, extras: string[] | undefined, scope: RequestScope | null, f?: typeof fetch) =>
    callDayApi("/api/game/day/mode", "POST", extras ? { mode, extras } : { mode }, f, undefined, undefined, scope),
  accept: (mission: string, scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/day/accept", "POST", { mission }, f, undefined, undefined, scope),
  pass: (mission: string, scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/day/pass", "POST", { mission }, f, undefined, undefined, scope),
  replace: (from: string, to: string, scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/day/replace", "POST", { from, to }, f, undefined, undefined, scope),
  tradingDays: (days: number[], scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/day/trading-days", "POST", { days }, f, undefined, undefined, scope),
  verify: (mission: string, scope: RequestScope | null, f?: typeof fetch) => callDayApi("/api/game/missions/verify", "POST", { mission }, f, undefined, undefined, scope),
};
