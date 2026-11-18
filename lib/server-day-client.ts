/**
 * Q4.4 — the app's calls to the server game day API (app/api/game/day/**, /api/game/missions/verify). Never throw:
 * a failure (no network, a refusal, the feature off) is an answer with a code, and nothing in the game changes from it.
 */
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
  state: "local" | "migration_pending" | "cloud_active";
  game_sync: boolean;
  game_day?: string;
  opening_mode?: "trading" | "study";
  trading_days?: number[];
  day: ServerDayRow | null;
  replacements_left?: number;
  day_full?: boolean;
}

export type DayCall = { ok: true; status: ServerDayStatus | null; body: Record<string, unknown> } | { ok: false; error: string; httpStatus?: number };

const TIMEOUT_MS = 10_000;

async function call(path: string, method: "GET" | "POST", body?: unknown, fetchImpl: typeof fetch = fetch): Promise<DayCall> {
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
    if (!res.ok) return { ok: false, error: typeof json.error === "string" ? json.error : "bad_response", httpStatus: res.status };
    const status = json.status && typeof json.status === "object" ? (json.status as ServerDayStatus) : null;
    return { ok: true, status, body: json };
  } catch {
    return { ok: false, error: "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const serverDay = {
  status: (f?: typeof fetch) => call("/api/game/day/status", "GET", undefined, f),
  open: (extras: string[], f?: typeof fetch) => call("/api/game/day/open", "POST", { extras }, f),
  mode: (mode: string, extras: string[] | undefined, f?: typeof fetch) => call("/api/game/day/mode", "POST", extras ? { mode, extras } : { mode }, f),
  accept: (mission: string, f?: typeof fetch) => call("/api/game/day/accept", "POST", { mission }, f),
  pass: (mission: string, f?: typeof fetch) => call("/api/game/day/pass", "POST", { mission }, f),
  replace: (from: string, to: string, f?: typeof fetch) => call("/api/game/day/replace", "POST", { from, to }, f),
  tradingDays: (days: number[], f?: typeof fetch) => call("/api/game/day/trading-days", "POST", { days }, f),
  verify: (mission: string, f?: typeof fetch) => call("/api/game/missions/verify", "POST", { mission }, f),
};
