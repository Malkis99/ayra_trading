/**
 * Backgrounds of the profile stage (pure CSS/SVG, no images). The chosen id is stored in profile.appearance.
 * Some are unlocked by achievements (never bought). Gold is used only by the rare one.
 * PLACEHOLDER: which achievement unlocks which background is a first proposal for the owner to confirm.
 */
export type StageBackgroundId = "graphite" | "nebula" | "deep_space" | "night_city" | "trading_hall" | "midnight_grid" | "gold_dawn";

export interface StageBackground {
  id: StageBackgroundId;
  /** Achievement id that unlocks it (none = open). */
  unlockAchievement?: string;
  rare?: boolean;
}

export const STAGE_BACKGROUNDS: StageBackground[] = [
  { id: "graphite" },
  { id: "nebula" },
  { id: "deep_space" },
  { id: "night_city", unlockAchievement: "firstTrade" },
  { id: "trading_hall", unlockAchievement: "firstPlan" },
  { id: "midnight_grid", unlockAchievement: "streakDay" },
  { id: "gold_dawn", unlockAchievement: "level3", rare: true },
];

export const DEFAULT_STAGE_BACKGROUND: StageBackgroundId = "nebula";

export function isStageBackgroundId(v: unknown): v is StageBackgroundId {
  return typeof v === "string" && STAGE_BACKGROUNDS.some((b) => b.id === v);
}

export function isStageBackgroundUnlocked(bg: StageBackground, achievements: Record<string, boolean>): boolean {
  return !bg.unlockAchievement || !!achievements[bg.unlockAchievement];
}
