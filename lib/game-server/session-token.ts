/**
 * Q4.5-2 — what a route reads from the access token the auth server has JUST accepted for this request
 * (docs/q4-5-2-server-economy-safety.md, section 4). Only these claims are read, and only to ask the database whether the
 * session is still fresh for the economy (game_session_check); the answer is the database's, never the token's.
 *
 * Call it only with the token that `auth.getUser(token)` verified: the signature is the auth server's check, not this one.
 */
import type { EconomyMode } from "@/lib/economy-mode";

export interface SessionToken {
  /** `sub` — must be the verified user's id */
  sub: string | null;
  /** `session_id` — the session at the auth server (a UUID), or null */
  sessionId: string | null;
  /** `iat` — when the token was issued, in seconds */
  iat: number | null;
  /** `ayra_economy` — the top-level claim the Custom Access Token Hook adds (0018): the state when the token was issued */
  claim: EconomyMode | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES: readonly string[] = ["local", "migration_scheduled", "migration_pending", "cloud_active"];

const EMPTY: SessionToken = { sub: null, sessionId: null, iat: null, claim: null };

export function sessionTokenOf(accessToken: string | null | undefined): SessionToken {
  const part = accessToken?.split(".")[1];
  if (!part) return EMPTY;
  try {
    const c = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      sub: typeof c.sub === "string" ? c.sub : null,
      sessionId: typeof c.session_id === "string" && UUID_RE.test(c.session_id) ? c.session_id : null,
      iat: typeof c.iat === "number" && Number.isSafeInteger(c.iat) && c.iat > 0 ? c.iat : null,
      // only the hook's top-level claim; app_metadata can be written by other means and is never read for the economy
      claim: typeof c.ayra_economy === "string" && STAGES.includes(c.ayra_economy) ? (c.ayra_economy as EconomyMode) : null,
    };
  } catch {
    return EMPTY;
  }
}
