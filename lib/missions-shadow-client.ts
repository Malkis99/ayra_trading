/**
 * Q4.2 — the app's side of the shadow mission check (docs/q4-2-mission-shadow.md).
 *
 * After «Verify» (already decided and saved by the app), the app sends what it decided to the server and keeps the
 * server's answer for diagnostics. It never waits for it, never shows it to the person and never changes the game with
 * it: XP, Coins, level, achievements, chronicle and the mission ledger stay exactly as the app's own check left them,
 * whatever the server says, and whether or not it answers.
 */
import type { ClientDecision, ShadowResult } from "./missions-shadow";

export const SHADOW_ENDPOINT = "/api/game/missions/shadow";
/** The last answers stay in this tab's memory only (record ids and codes; never record text), gone on reload. */
const KEEP = 10;
let kept: ShadowOutcome[] = [];
const TIMEOUT_MS = 10_000;

export const missionShadowOn = () => process.env.NEXT_PUBLIC_AYRA_MISSION_SHADOW === "1";

export type ShadowOutcome =
  | { at: string; ok: true; sent: ClientDecision[]; result: ShadowResult }
  | { at: string; ok: false; sent: ClientDecision[]; error: string; status?: number };

function keep(outcome: ShadowOutcome) {
  kept = [...kept, outcome].slice(-KEEP);
  // diagnostics (and the e2e tests) read the kept answers of this tab
  (window as unknown as { __ayraMissionShadow?: ShadowOutcome[] }).__ayraMissionShadow = kept;
  try {
    window.dispatchEvent(new CustomEvent("ayra:mission-shadow", { detail: outcome }));
  } catch {
    /* no window events */
  }
}

/** Sends the app's decisions; resolves with the outcome (never throws). */
export async function sendMissionShadow(sent: ClientDecision[], fetchImpl: typeof fetch = fetch): Promise<ShadowOutcome> {
  const at = new Date().toISOString();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  let outcome: ShadowOutcome;
  try {
    const res = await fetchImpl(SHADOW_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missions: sent }),
      signal: ctrl?.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    outcome = res.ok && body.mode === "shadow"
      ? { at, ok: true, sent, result: body as unknown as ShadowResult }
      : { at, ok: false, sent, error: typeof body.error === "string" ? body.error : "bad_response", status: res.status };
  } catch {
    outcome = { at, ok: false, sent, error: "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (typeof window !== "undefined") keep(outcome);
  return outcome;
}

/** The kept answers of this tab (diagnostics and tests). */
export function readShadowOutcomes(): ShadowOutcome[] {
  return kept;
}

/** Tests only: forget the kept answers. */
export function resetShadowOutcomes() {
  kept = [];
}
