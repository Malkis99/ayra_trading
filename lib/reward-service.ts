/**
 * RewardService — the one way the Quests UI asks for a reward (docs/quests-2.0-plan.md, 2.1).
 *
 * Today it is a thin adapter to the existing Q1 rewards on this device (lib/game-context.tsx: the protected, locked
 * change). The server economy (Q4) will provide another implementation of the same interface, so the screens do not
 * change. No rate lives here: amounts come from the existing rules (lib/game.ts, GAME_CONFIG).
 */

export interface RewardOutcome {
  /** Given and saved. */
  completed: boolean;
  xp: number;
  leveledUp: boolean;
  newLevel?: number;
  newlyUnlocked: string[];
  /** Could not be saved: nothing was given (try again). */
  saveFailed?: boolean;
  /** Less XP than the quest's value: the daily cap on self-report XP was reached. */
  capped?: boolean;
}

export interface RewardService {
  /** Which implementation answers (the screen may say «kept on this device» for the local one). */
  readonly kind: "device" | "server";
  /** A quest the person ticks: its existing XP, no coins (owner decision 2026-10-27). Journal-checked quests close by themselves. */
  completeSelfReport(quest: { id: string; title: string; category: string; xp: number }): Promise<RewardOutcome>;
}

/** The device implementation over the game context's protected change. */
export function deviceRewardService(completeQuestSafe: (questId: string, title: string, category: string, xp?: number) => Promise<RewardOutcome>): RewardService {
  return {
    kind: "device",
    completeSelfReport: (q) => completeQuestSafe(q.id, q.title, q.category, q.xp),
  };
}
