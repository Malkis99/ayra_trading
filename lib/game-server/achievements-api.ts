/**
 * Q4.6 — the person's own achievements on the server (docs/q4-6-achievements-migration.md).
 *   GET /api/game/achievements → { state, transferred, achievements: [{ id, family, status, detail, recordedAt }] }
 * Read only: nothing here unlocks, changes or pays anything (no client request can — the database writes achievements
 * only in the owner's activation and decisions). The user is the verified session's; the database checks the session
 * is fresh (game_achievements_for_session, 0020) and answers for that account only.
 */
import { readAchievements } from "../server-achievements";
import { forAccount, gate, refusalOf, reply, type ApiHttp, type DayApiDeps } from "./day-api";

export { readAchievements, type ServerAchievement } from "../server-achievements";

export const ACHIEVEMENTS_API_RATE = { limit: 30, windowMs: 60_000 };

export async function handleAchievementsApi(req: Request, deps: DayApiDeps): Promise<ApiHttp> {
  if (req.method !== "GET") return reply(405, { error: "method_not_allowed" }, { Allow: "GET" });
  const g = await gate(req, deps, true);
  if ("refused" in g) return g.refused;
  const user = g.user;
  if (user.token.sub !== user.id) return forAccount(reply(401, { error: "session_stale", reason: "session_revoked" }), user.id);
  try {
    const { data, error } = await deps.rpc("game_achievements_for_session", { p_user: user.id, p_session: user.token.sessionId, p_iat: user.token.iat, p_claim: user.token.claim });
    if (error) {
      if ((error.message || "").trim() === "game_session_stale") return forAccount(reply(401, { error: "session_stale" }), user.id);
      const r = refusalOf(error);
      return forAccount(reply(r.status, { error: r.reason }), user.id);
    }
    const out = readAchievements(data);
    if (!out) return forAccount(reply(503, { error: "server_error" }), user.id);
    return forAccount(reply(200, { ...out }), user.id);
  } catch {
    return forAccount(reply(503, { error: "server_error" }), user.id);
  }
}
