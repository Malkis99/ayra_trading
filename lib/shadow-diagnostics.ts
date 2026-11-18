/**
 * Q4.3 — the minimal statistics model of shadow-check mismatches (docs/q4-3-server-game-day.md, section 6).
 *
 * One row per mismatch: its category, the mission code, the game day, the rules version and the check time. Nothing
 * else: no user id, no record id, no Journal text, no source key. The same categories are the CHECK of
 * game_shadow_diagnostics in migration 0015 (parity-tested).
 *
 * Only the model: NOTHING sends these rows yet (the owner decides when; the table and game_record_shadow exist in
 * 0015, which is not applied).
 */
import type { MissionId } from "./missions";
import type { ShadowResult } from "./missions-shadow";

export const SHADOW_DIAGNOSTIC_CATEGORIES = [
  "client_only",
  "server_only",
  "source_differs",
  "dayDiffers",
  "sourceNotConfirmed",
  "sourceUnknownForm",
  "stampAfterServerWrite",
  "duplicateSource",
  "newerSchema",
  "badRecord",
  "notAssigned",
  "notAccepted",
  "alreadyPaid",
  "dayFull",
  "sourceUsed",
  "dayNotOpen",
] as const;
export type ShadowDiagnosticCategory = (typeof SHADOW_DIAGNOSTIC_CATEGORIES)[number];

/** The rules the shadow check applies (bumped when lib/missions.ts or the server day rules change). */
export const SHADOW_RULES_VERSION = "q4.3";

export interface ShadowDiagnosticRow {
  category: ShadowDiagnosticCategory;
  mission_id: MissionId;
  game_day: string;
  rules_version: string;
  /** Check time (the server fills it when the row is written). */
  checked_at: string;
}

const isCategory = (c: string): c is ShadowDiagnosticCategory => (SHADOW_DIAGNOSTIC_CATEGORIES as readonly string[]).includes(c);

/** The mismatch rows of one shadow answer: one per comparison mismatch and per server flag. Agreement gives none. */
export function shadowDiagnosticRows(result: ShadowResult, checkedAt: Date, rulesVersion: string = SHADOW_RULES_VERSION): ShadowDiagnosticRow[] {
  const rows: ShadowDiagnosticRow[] = [];
  for (const r of result.results) {
    const cats = new Set<string>();
    if (r.comparison !== "agree_done" && r.comparison !== "agree_not_done") cats.add(r.comparison);
    for (const f of r.server.flags) cats.add(f);
    for (const c of cats) {
      if (!isCategory(c)) continue;
      rows.push({ category: c, mission_id: r.id, game_day: result.serverDay, rules_version: rulesVersion, checked_at: checkedAt.toISOString() });
    }
  }
  // the database takes at most ten rows a call (game_record_shadow); a larger answer is cut, never split into more calls
  return rows.slice(0, 10);
}
