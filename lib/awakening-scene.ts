/**
 * Visual "mood" of the onboarding stage, derived from the answers (pure, no stored state).
 * Answers never change the character's body — only the light, aura and symbols around it.
 * Gold is not used here: it is reserved for the awakening moment and achievements.
 */

export type AuraTone = "violet" | "teal" | "blue" | "rose" | "indigo";
export type SceneSymbol = "fx" | "index" | "metal" | "energy" | "stock" | "crypto" | "other";
export type ScenePace = "calm" | "steady" | "fast";

export interface SceneState {
  /** 0..1 — how "awake" the character looks (grows with progress through the steps). */
  awaken: number;
  tone: AuraTone;
  /** Market symbols orbiting the character (max 4). */
  symbols: SceneSymbol[];
  /** 0..1 — aura strength (experience). */
  intensity: number;
  pace: ScenePace;
}

const MARKET_SYMBOL: Record<string, SceneSymbol> = {
  forex: "fx",
  indices: "index",
  metals: "metal",
  energy: "energy",
  stocks: "stock",
  crypto: "crypto",
  other: "other",
};

const PROBLEM_TONE: Record<string, AuraTone> = {
  discipline: "violet",
  emotions: "teal",
  risk_mgmt: "blue",
  no_system: "indigo",
  unstable_result: "rose",
  market_analysis: "blue",
  lack_of_time: "teal",
};

const GOAL_TONE: Record<string, AuraTone> = {
  master_discipline: "violet",
  emotional_control: "teal",
  market_understanding: "blue",
  systematic_approach: "indigo",
};

const EXPERIENCE_INTENSITY: Record<string, number> = {
  less_than_1: 0.4,
  "1_2_years": 0.6,
  "3_5_years": 0.8,
  more_than_5: 1,
};

const STYLE_PACE: Record<string, ScenePace> = {
  scalping: "fast",
  daytrading: "fast",
  swing: "steady",
  positional: "calm",
  undecided: "steady",
};

export const TOTAL_STEPS = 5;

/** Progress 0..1 through the questions: steps 1–4, each split by its questions. */
export function progressOf(step: number, subStep: number, questionsInStep: number): number {
  const s = Math.min(Math.max(step, 1), TOTAL_STEPS);
  if (s >= TOTAL_STEPS) return 1;
  const within = questionsInStep > 0 ? Math.min(subStep, questionsInStep) / questionsInStep : 0;
  return Math.min(1, (s - 1 + within) / (TOTAL_STEPS - 1));
}

export function deriveScene(answers: Record<string, unknown>, progress: number): SceneState {
  const markets = Array.isArray(answers.markets) ? (answers.markets as string[]) : [];
  const goals = Array.isArray(answers.tradingGoal) ? (answers.tradingGoal as string[]) : [];
  const problem = typeof answers.mainProblem === "string" ? answers.mainProblem : "";
  const goalTone = goals.map((g) => GOAL_TONE[g]).find(Boolean);
  return {
    awaken: Math.round((0.35 + 0.65 * Math.min(Math.max(progress, 0), 1)) * 100) / 100,
    tone: goalTone ?? PROBLEM_TONE[problem] ?? "violet",
    symbols: markets.map((m) => MARKET_SYMBOL[m]).filter((x): x is SceneSymbol => Boolean(x)).slice(0, 4),
    intensity: EXPERIENCE_INTENSITY[String(answers.experience ?? "")] ?? 0.5,
    pace: STYLE_PACE[String(answers.tradingStyle ?? "")] ?? "steady",
  };
}

/** Short key that changes only when the scene visibly changes (used to play the transition pulse). */
export function sceneKey(s: SceneState): string {
  return [s.tone, s.symbols.join("."), s.intensity, s.pace].join("|");
}

/** CSS colour pairs per aura tone (light, deep). */
export const TONE_COLORS: Record<AuraTone, [string, string]> = {
  violet: ["163 138 209", "80 52 143"],
  teal: ["94 214 196", "28 104 110"],
  blue: ["120 168 240", "40 70 150"],
  rose: ["236 140 178", "130 50 100"],
  indigo: ["140 140 236", "60 52 150"],
};

/** PLACEHOLDER limits for decorative particles (performance on mid-range phones). */
export const STAGE_PARTICLES_DESKTOP = 18;
export const STAGE_PARTICLES_MOBILE = 10;
export const FINALE_MAX_PARTICLES_DESKTOP = 70;
export const FINALE_MAX_PARTICLES_MOBILE = 36;
