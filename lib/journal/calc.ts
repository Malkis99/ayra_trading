import { Trade, TradeResult, TradeDirection } from "./types";

export const BREAKEVEN_R_THRESHOLD = 0.05; // Placeholder threshold in config

export function parseNumberInput(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;

  let str = value.toString().replace(/\s+/g, "");

  // Handle thousand separators vs decimal marks
  const lastComma = str.lastIndexOf(",");
  const lastDot = str.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma < lastDot) {
      // 1,234.56 format -> remove commas
      str = str.replace(/,/g, "");
    } else {
      // 1.234,56 format -> remove dots and replace comma with dot
      str = str.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastComma !== -1) {
    // 1234,56 format -> replace comma with dot
    str = str.replace(",", ".");
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

export function normalizeInstrument(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function calculateRMultiple(params: {
  direction: TradeDirection;
  pnlMoney?: number | null;
  riskAmount?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopLoss?: number | null;
}): number | null {
  const { direction, pnlMoney, riskAmount, entryPrice, exitPrice, stopLoss } = params;

  // Primary formula: PnL / Risk
  if (
    pnlMoney !== undefined &&
    pnlMoney !== null &&
    riskAmount !== undefined &&
    riskAmount !== null &&
    riskAmount > 0
  ) {
    return pnlMoney / riskAmount;
  }

  // Fallback price formula: (exit - entry) / (entry - stopLoss) for LONG
  // (entry - exit) / (stopLoss - entry) for SHORT
  if (
    entryPrice !== undefined &&
    entryPrice !== null &&
    exitPrice !== undefined &&
    exitPrice !== null &&
    stopLoss !== undefined &&
    stopLoss !== null
  ) {
    if (direction === "long") {
      const riskPips = entryPrice - stopLoss;
      if (riskPips <= 0) return null; // Invalid SL for Long
      const rewardPips = exitPrice - entryPrice;
      return rewardPips / riskPips;
    } else {
      const riskPips = stopLoss - entryPrice;
      if (riskPips <= 0) return null; // Invalid SL for Short
      const rewardPips = entryPrice - exitPrice;
      return rewardPips / riskPips;
    }
  }

  return null;
}

export function determineTradeResult(params: {
  pnlMoney?: number | null;
  rMultiple?: number | null;
}): TradeResult {
  const { pnlMoney, rMultiple } = params;

  if (rMultiple !== undefined && rMultiple !== null) {
    if (Math.abs(rMultiple) < BREAKEVEN_R_THRESHOLD) return "breakeven";
    return rMultiple > 0 ? "win" : "loss";
  }

  if (pnlMoney !== undefined && pnlMoney !== null) {
    if (pnlMoney === 0) return "breakeven";
    return pnlMoney > 0 ? "win" : "loss";
  }

  return "breakeven";
}

export function calculatePnlPercent(
  pnlMoney: number | null | undefined,
  startBalance: number | null | undefined
): number | null {
  if (
    pnlMoney === undefined ||
    pnlMoney === null ||
    startBalance === undefined ||
    startBalance === null ||
    startBalance <= 0
  ) {
    return null;
  }
  return (pnlMoney / startBalance) * 100;
}

export interface TradeValidationErrors {
  accountId?: string;
  instrument?: string;
  openedAt?: string;
  closedAt?: string;
  pnlMoney?: string;
  riskAmount?: string;
  entryPrice?: string;
  exitPrice?: string;
  stopLoss?: string;
  general?: string;
}

export function validateTradeInputs(data: {
  accountId: string;
  instrument: string;
  openedAt: string;
  closedAt?: string;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopLoss?: number | null;
}): TradeValidationErrors {
  const errors: TradeValidationErrors = {};

  if (!data.accountId) {
    errors.accountId = "required";
  }

  if (!data.instrument || !normalizeInstrument(data.instrument)) {
    errors.instrument = "required";
  }

  const openDate = new Date(data.openedAt);
  if (isNaN(openDate.getTime())) {
    errors.openedAt = "invalidDate";
  } else {
    // Cannot be more than 24 hours in future
    const maxFuture = Date.now() + 24 * 60 * 60 * 1000;
    if (openDate.getTime() > maxFuture) {
      errors.openedAt = "futureDate";
    }
  }

  if (data.closedAt) {
    const closeDate = new Date(data.closedAt);
    if (isNaN(closeDate.getTime())) {
      errors.closedAt = "invalidDate";
    } else {
      if (openDate && closeDate.getTime() < openDate.getTime()) {
        errors.closedAt = "closedBeforeOpened";
      }
    }
  }

  return errors;
}
