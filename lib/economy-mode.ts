/**
 * Q4.4 — which side keeps the game economy of this account (docs/q4-4-server-day-api.md, section 3).
 *
 *   local             — the device (GameStore), exactly as before: XP and Coins are given on the device.
 *   migration_pending — the progress is being moved to the server: NO rewards anywhere (device or server).
 *   cloud_active      — the server keeps the game day and the rewards; the device economy never comes back. With
 *                       game_sync off the server pauses its rewards (and the device still gives none).
 *
 * The mode only ever moves forward. Once this device has seen «migration_pending» or «cloud_active», it keeps it in the
 * account's storage space: a failed request, an offline start or a switched-off feature never turn the device economy
 * back on. Only «local» (no record) lets the device give rewards.
 */
import { AppStorage } from "./storage";
import type { GameState } from "./game";

export type EconomyMode = "local" | "migration_pending" | "cloud_active";
export const ECONOMY_MODE_KEY = "ayra_economy_mode";
const ORDER: Record<EconomyMode, number> = { local: 0, migration_pending: 1, cloud_active: 2 };

export const isEconomyMode = (v: unknown): v is EconomyMode => v === "local" || v === "migration_pending" || v === "cloud_active";

/** The feature switch (off unless the owner sets it): without it the app never asks the server. */
export const serverEconomyOn = () => process.env.NEXT_PUBLIC_AYRA_SERVER_ECONOMY === "1";

/** The mode this device last knew for the active space (local when it never saw another one). */
export function readStickyMode(): EconomyMode {
  try {
    const v = AppStorage.getItem(ECONOMY_MODE_KEY);
    return isEconomyMode(v) ? v : "local";
  } catch {
    return "local";
  }
}

/** Keeps the later of the known and the reported mode (never backwards). Returns the mode in force. */
export function rememberMode(reported: EconomyMode, spaceId: string = AppStorage.getActiveSpaceId()): EconomyMode {
  const known = readStickyMode();
  const next = ORDER[reported] > ORDER[known] ? reported : known;
  if (next !== known) {
    try {
      AppStorage.guardedSetItem(ECONOMY_MODE_KEY, next, spaceId);
    } catch {
      /* no room: the mode still holds for this session (the caller keeps it in memory) */
    }
  }
  return next;
}

export const laterMode = (a: EconomyMode, b: EconomyMode): EconomyMode => (ORDER[a] >= ORDER[b] ? a : b);

/**
 * A change gives a reward: XP, level or Coins move, an achievement is unlocked, a quest is newly marked done, or a
 * personal quest is newly paid. Outside «local» such a change is refused as a whole (nothing is half-given).
 */
export function givesReward(prev: GameState, next: GameState): boolean {
  if (next.xp !== prev.xp || next.level !== prev.level || next.coins !== prev.coins) return true;
  for (const [a, on] of Object.entries(next.achievements || {})) if (on && !prev.achievements?.[a]) return true;
  const sameDay = prev.lastQuestDate === next.lastQuestDate;
  if (sameDay) for (const q of Object.keys(next.completedQuestsToday || {})) if (next.completedQuestsToday[q] && !prev.completedQuestsToday?.[q]) return true;
  const ledgerXp = (s: GameState) => (s.personalLedger || []).reduce((sum, e) => sum + (e.xp || 0), 0);
  if (ledgerXp(next) > ledgerXp(prev)) return true;
  return false;
}
