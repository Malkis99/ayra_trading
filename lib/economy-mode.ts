/**
 * Q4.4 / Q4.5-1 — which side keeps the game economy of this account (docs/q4-4-server-day-api.md, section 3;
 * docs/q4-5-1-client-economy-safety.md).
 *
 *   local               — the device (GameStore), exactly as before: XP and Coins are given on the device.
 *   migration_scheduled — the server announced a move (Q4.5-2). Owner decision 2026-11-18: until the move really
 *                         starts, the device economy works as before (XP, Coins, achievements); what is earned now is
 *                         part of the device progress the move will collect (Q4.5-4).
 *   migration_pending   — the progress is being moved to the server: NO new rewards anywhere (device or server).
 *   cloud_active        — the server keeps the game day and the rewards; the device economy never comes back. With
 *                         game_sync off the server pauses its rewards (and the device still gives none).
 *
 * The mode only ever moves forward. It is the LATEST of what this device knows from three sources:
 *   1. its own record in the account's storage space (`ayra_economy_mode`);
 *   2. the account's session: `app_metadata.ayra_economy`, written only by the server (Q4.5-2) and carried by the
 *      session token, so it is there on a new device, in a private window and after the device storage was cleared;
 *   3. the server's answer to /api/game/day/status (only with the server economy switched on).
 * A mark from any source is kept; nothing — an error, being offline, a switched-off feature, an older token — moves
 * the device back.
 *
 * NOT A PROOF OF «local»: no mark anywhere only means «nothing marked this account as far as this device knows». A token
 * issued before the server marked the account still has no mark until it is refreshed (an access token stays valid
 * until it expires, even after its session is revoked). The device keeps the old behaviour then (rewards on the
 * device), and says so in `basis`; making such a token worthless and refusing what it earned is the server's job
 * (Q4.5-2: mark + revoke sessions; Q4.5-4: cut-off of device progress by server time).
 */
import { AppStorage } from "./storage";
import type { GameState } from "./game";

export type EconomyMode = "local" | "migration_scheduled" | "migration_pending" | "cloud_active";
export const ECONOMY_MODE_KEY = "ayra_economy_mode";
/** The `app_metadata` key the server writes (Q4.5-2). */
export const ECONOMY_CLAIM_KEY = "ayra_economy";
const ORDER: Record<EconomyMode, number> = { local: 0, migration_scheduled: 1, migration_pending: 2, cloud_active: 3 };

export const isEconomyMode = (v: unknown): v is EconomyMode =>
  v === "local" || v === "migration_scheduled" || v === "migration_pending" || v === "cloud_active";

/** The feature switch (off unless the owner sets it): without it the app never asks the server's status API. */
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

/** The device gives rewards in «local» and in «migration_scheduled» (owner decision 2026-11-18), never after the move started. */
export const deviceRewardsAllowed = (mode: EconomyMode) => mode === "local" || mode === "migration_scheduled";

/**
 * The reward gate, decided at the moment of the change by the LATEST of every mode known then (this tab's memory and
 * what another tab may have just saved): a change that gives a reward is refused once any of them says the move started.
 */
export function refusesReward(prev: GameState, next: GameState, ...known: EconomyMode[]): boolean {
  const mode = known.reduce<EconomyMode>((a, b) => laterMode(a, b), "local");
  return !deviceRewardsAllowed(mode) && givesReward(prev, next);
}

/* ------------------------------------------------------------------ the session's mark (Q4.5-1) */

/** What the account's session says about the economy. */
export interface SessionEconomy {
  /** The account the session belongs to (a mark is applied only to that account's space). */
  userId: string;
  /** `app_metadata.ayra_economy` when it holds a known mode; null when there is none (NOT a proof of «local»). */
  claim: EconomyMode | null;
  /** «verified»: the user record came from the auth server just now (getUser, a refresh); «cached»: the stored session. */
  source: "verified" | "cached";
  /** When the access token expires (ms), or null when unknown. */
  expiresAt: number | null;
}

/** The mark in `app_metadata` (anything else — missing, unknown words, wrong types — is «no mark»). */
export function claimOf(appMetadata: Record<string, unknown> | null | undefined): EconomyMode | null {
  const v = appMetadata?.[ECONOMY_CLAIM_KEY];
  return isEconomyMode(v) ? v : null;
}

export function sessionEconomyOf(
  user: { id: string; app_metadata?: Record<string, unknown> | null } | null | undefined,
  source: SessionEconomy["source"],
  expiresAtSec?: number | null
): SessionEconomy | null {
  if (!user?.id) return null;
  return { userId: user.id, claim: claimOf(user.app_metadata), source, expiresAt: typeof expiresAtSec === "number" ? expiresAtSec * 1000 : null };
}

/**
 * A new reading of the same account's session joined to what is already known. The auth events do not arrive in a fixed
 * order (getSession, getUser, INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, another tab): an older stored session may come
 * after the auth server's fresher answer. For one account the mark never goes back — the stricter one is kept (the server
 * never moves an account backwards). The freshness (source and expiry) belongs to one token and is never mixed from two:
 * the token that expires later is the newer one and brings its own source (a newer token only read from storage is not
 * verified); for the same token a verified reading wins; an older token changes nothing. Another account, or no session,
 * replaces it.
 */
export function mergeSessionEconomy(prev: SessionEconomy | null, next: SessionEconomy | null): SessionEconomy | null {
  if (!next || !prev || prev.userId !== next.userId) return next;
  const claim = prev.claim && next.claim ? laterMode(prev.claim, next.claim) : prev.claim ?? next.claim;
  let source = prev.source;
  let expiresAt = prev.expiresAt;
  if (next.expiresAt !== null && (prev.expiresAt === null || next.expiresAt > prev.expiresAt)) {
    source = next.source;
    expiresAt = next.expiresAt;
  } else if (next.expiresAt === prev.expiresAt && next.source === "verified") {
    source = "verified";
  }
  if (claim === prev.claim && source === prev.source && expiresAt === prev.expiresAt) return prev;
  return { userId: next.userId, claim, source, expiresAt };
}

/**
 * On what the device's answer rests (diagnostics and the notice; rewards depend on the mode alone):
 *   marked      — a mark from the device record, the session or the server (rewards then follow the mode:
 *                 «scheduled» still pays on the device, «pending» and «cloud» never);
 *   confirmed   — no mark, and the session was verified by the auth server while its token is still valid;
 *   unconfirmed — no mark, but nothing fresh says so (offline, an expired or never-verified token, the server not
 *                 asked). The old behaviour stays (device rewards); this is exactly the gap Q4.5-2 and Q4.5-4 close.
 */
export type EconomyBasis = "marked" | "confirmed" | "unconfirmed";

export function economyBasis(mode: EconomyMode, session: SessionEconomy | null, now: number): EconomyBasis {
  if (mode !== "local") return "marked";
  if (session && session.source === "verified" && session.expiresAt !== null && session.expiresAt > now) return "confirmed";
  return "unconfirmed";
}

/**
 * The auth server's late answer about an account (getUser started at load) joins only the session still known for that
 * account: after a sign-out or another account's sign-in it is dropped, never brought back as a verified session.
 */
export function joinVerifiedReading(prev: SessionEconomy | null, verified: SessionEconomy | null): SessionEconomy | null {
  if (!prev || !verified || prev.userId !== verified.userId) return prev;
  return mergeSessionEconomy(prev, verified);
}

/**
 * The mode in force for the loaded space: the latest of the device's own knowledge, the session's mark (only when the
 * session is this space's account) and the server's last answer.
 */
export function resolveEconomyMode(input: { known: EconomyMode; spaceId: string | null; session: SessionEconomy | null; server?: EconomyMode | null }): EconomyMode {
  let mode = input.known;
  if (input.session && input.session.claim && input.spaceId === `account:${input.session.userId}`) mode = laterMode(mode, input.session.claim);
  if (input.server) mode = laterMode(mode, input.server);
  return mode;
}

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
