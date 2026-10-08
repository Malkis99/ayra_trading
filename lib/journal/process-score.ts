import { Trade, Strategy, Account, ProcessScoreSnapshot, ProcessScoreComponent } from "./types";
import { GAME_CONFIG } from "../game-config";

export interface ComponentResult {
  score: number;
  available: boolean;
}

export function calculateRulesScore(
  trade: Trade,
  strategy?: Strategy | null
): ComponentResult {
  if (!strategy || !strategy.rules || strategy.rules.length === 0) {
    return { score: 0, available: false };
  }

  const checks = trade.ruleChecks || {};
  let totalWeight = 0;
  let passedWeight = 0;

  for (const rule of strategy.rules) {
    const checkValue = checks[rule.id];
    if (checkValue === "passed" || checkValue === "failed") {
      const weightMultiplier =
        rule.weight === "required"
          ? GAME_CONFIG.PROCESS_SCORE.REQUIRED_RULE_MULTIPLIER
          : 1.0;
      totalWeight += weightMultiplier;
      if (checkValue === "passed") {
        passedWeight += weightMultiplier;
      }
    }
  }

  if (totalWeight === 0) {
    return { score: 0, available: false };
  }

  const score = (passedWeight / totalWeight) * 100;
  return { score, available: true };
}

export function calculateRiskScore(
  trade: Trade,
  strategy?: Strategy | null,
  account?: Account | null
): ComponentResult {
  if (!strategy || !strategy.riskLimit) {
    return { score: 0, available: false };
  }

  const limit = strategy.riskLimit;

  if (limit.type === "r") {
    // If trade has SL or riskAmount, risk was defined
    if (trade.stopLoss != null || trade.riskAmount != null) {
      return { score: 100, available: true };
    }
    return { score: 0, available: true };
  }

  if (limit.type === "percent") {
    if (trade.riskAmount != null && account?.startBalance && account.startBalance > 0) {
      const actualPct = (trade.riskAmount / account.startBalance) * 100;
      const isWithinLimit = actualPct <= limit.value + 0.01;
      return { score: isWithinLimit ? 100 : 0, available: true };
    }
    if (trade.stopLoss != null || trade.riskAmount != null) {
      return { score: 100, available: true };
    }
    return { score: 0, available: true };
  }

  return { score: 0, available: false };
}

export function calculateSessionScore(
  trade: Trade,
  strategy?: Strategy | null
): ComponentResult {
  if (
    !strategy ||
    !strategy.allowedSessions ||
    strategy.allowedSessions.length === 0
  ) {
    return { score: 0, available: false };
  }

  if (trade.session) {
    const isAllowed = strategy.allowedSessions.includes(trade.session);
    return { score: isAllowed ? 100 : 0, available: true };
  }

  return { score: 0, available: true };
}

export function calculateMistakesPenalty(trade: Trade): number {
  const penalizable = (trade.mistakes || []).filter((m) => m !== "other");
  const count = penalizable.length;
  // Penalty = min(3 * count * 5, 30) = min(15 * count, 30)
  return Math.min(count * GAME_CONFIG.PROCESS_SCORE.MISTAKE_PENALTY_PER_ITEM, GAME_CONFIG.PROCESS_SCORE.MAX_MISTAKE_PENALTY);
}

export function calculateProcessScore(
  trade: Trade,
  strategy?: Strategy | null,
  account?: Account | null,
  calculatedAtISO?: string
): { score: number | null; snapshot: ProcessScoreSnapshot } {
  const rulesRes = calculateRulesScore(trade, strategy);
  const riskRes = calculateRiskScore(trade, strategy, account);
  const sessionRes = calculateSessionScore(trade, strategy);
  const mistakesPenalty = calculateMistakesPenalty(trade);

  const baseWeights = GAME_CONFIG.PROCESS_SCORE.WEIGHTS;
  const candidateComponents: {
    key: "rules" | "risk" | "session";
    result: ComponentResult;
    baseWeight: number;
  }[] = [
    { key: "rules", result: rulesRes, baseWeight: baseWeights.rules },
    { key: "risk", result: riskRes, baseWeight: baseWeights.risk },
    { key: "session", result: sessionRes, baseWeight: baseWeights.session },
  ];

  const availableComponents = candidateComponents.filter((c) => c.result.available);
  const totalBaseWeight = availableComponents.reduce((acc, c) => acc + c.baseWeight, 0);

  const nowISO = calculatedAtISO || new Date().toISOString();

  if (totalBaseWeight === 0) {
    return {
      score: null,
      snapshot: {
        score: null,
        formulaVersion: "1.0",
        components: [],
        mistakesPenalty,
        calculatedAt: nowISO,
      },
    };
  }

  const snapshotComponents: ProcessScoreComponent[] = [];
  let sumContributions = 0;

  for (const comp of availableComponents) {
    const normalizedWeight = (comp.baseWeight / totalBaseWeight) * 100;
    const rawContribution = (comp.result.score * normalizedWeight) / 100;
    sumContributions += rawContribution;

    snapshotComponents.push({
      key: comp.key,
      score: Math.round(comp.result.score),
      weight: Math.round(normalizedWeight),
      rawContribution: Number(rawContribution.toFixed(2)),
    });
  }

  const finalScore = Math.max(0, Math.round(sumContributions - mistakesPenalty));

  return {
    score: finalScore,
    snapshot: {
      score: finalScore,
      formulaVersion: "1.0",
      components: snapshotComponents,
      mistakesPenalty,
      calculatedAt: nowISO,
    },
  };
}

export function getProcessScoreCategory(
  score: number | null
): "good" | "medium" | "bad" | "none" {
  if (score === null || score === undefined) return "none";
  if (score >= GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.GOOD) return "good";
  if (score < GAME_CONFIG.PROCESS_SCORE.THRESHOLDS.BAD) return "bad";
  return "medium";
}
