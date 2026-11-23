/**
 * Q4.6 — the server's achievements as the app reads them (GET /api/game/achievements; docs/q4-6-achievements-migration.md).
 * Pure (no Node, no React): used by the route and by the game. Only well-formed items pass; nothing is guessed.
 */

const STATUSES = ["verified", "legacy_accepted", "pending_review", "rejected"];
const FAMILIES = ["profile", "category", "week"];
const STATES = ["local", "migration_scheduled", "migration_pending", "cloud_active"];

export interface ServerAchievement {
  id: string;
  family: "profile" | "category" | "week";
  status: "verified" | "legacy_accepted" | "pending_review" | "rejected";
  detail: Record<string, unknown>;
  recordedAt: string | null;
}

/** The database's answer → only well-formed items (anything else is dropped, never guessed). */
export function readAchievements(raw: unknown): { state: string; transferred: boolean; achievements: ServerAchievement[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { state?: unknown; transferred?: unknown; achievements?: unknown };
  if (typeof r.state !== "string" || !STATES.includes(r.state) || !Array.isArray(r.achievements)) return null;
  const achievements: ServerAchievement[] = [];
  for (const a of r.achievements) {
    const x = a as Record<string, unknown>;
    if (!x || typeof x.id !== "string" || !STATUSES.includes(x.status as string) || !FAMILIES.includes(x.family as string)) continue;
    achievements.push({
      id: x.id,
      family: x.family as ServerAchievement["family"],
      status: x.status as ServerAchievement["status"],
      detail: x.detail && typeof x.detail === "object" && !Array.isArray(x.detail) ? (x.detail as Record<string, unknown>) : {},
      recordedAt: typeof x.recordedAt === "string" ? x.recordedAt : null,
    });
  }
  return { state: r.state, transferred: r.transferred === true, achievements };
}

