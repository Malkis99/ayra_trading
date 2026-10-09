import {
  Account,
  PropToastLog,
  PropLimitStatus,
  PropLimitType,
} from "./types";
import {
  calculatePropMetrics,
  getPropFirmDayKey,
  PropMetricsSummary,
} from "./prop";

const PROP_TOAST_STORAGE_KEY = "ayra_prop_toasts_v1";

const STATUS_ORDER: Record<PropLimitStatus, number> = {
  ok: 0,
  caution: 1,
  close: 2,
  reached: 3,
};

export function getPropToastLog(): PropToastLog {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROP_TOAST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePropToastLog(log: PropToastLog): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROP_TOAST_STORAGE_KEY, JSON.stringify(log));
  } catch (e) {
    console.error("Failed to save prop toast log to localStorage", e);
  }
}

export interface PropToastAlert {
  limitType: PropLimitType;
  level: PropLimitStatus;
  usedPct: number;
}

/**
 * Evaluates whether a toast alert should be shown after a trade mutation.
 * Returns the highest reached alert if status increased and wasn't shown today.
 */
export function evaluatePropToastAlert(
  account: Account,
  previousMetrics: PropMetricsSummary | undefined,
  currentMetrics: PropMetricsSummary | undefined,
  nowDate: Date = new Date(),
  toastLog: PropToastLog = getPropToastLog()
): { alert: PropToastAlert | null; updatedLog: PropToastLog } {
  if (!account.propRules || !currentMetrics) {
    return { alert: null, updatedLog: toastLog };
  }

  const todayKey = getPropFirmDayKey(nowDate, account.propRules.dayReset);
  const accountLog = toastLog[account.id];

  // If day changed or log missing, initialize clean entry for today
  let currentShown: string[] = [];
  if (accountLog && accountLog.dayKey === todayKey) {
    currentShown = [...accountLog.shown];
  }

  const limits: Array<{ type: PropLimitType; prevStatus: PropLimitStatus; currStatus: PropLimitStatus; usedPct: number }> = [];

  if (currentMetrics.dailyLoss) {
    limits.push({
      type: "dailyLoss",
      prevStatus: previousMetrics?.dailyLoss?.status || "ok",
      currStatus: currentMetrics.dailyLoss.status,
      usedPct: currentMetrics.dailyLoss.usedPct,
    });
  }

  if (currentMetrics.totalDrawdown) {
    limits.push({
      type: "totalDrawdown",
      prevStatus: previousMetrics?.totalDrawdown?.status || "ok",
      currStatus: currentMetrics.totalDrawdown.status,
      usedPct: currentMetrics.totalDrawdown.usedPct,
    });
  }

  // Find limits where status increased above "ok"
  let highestAlert: PropToastAlert | null = null;
  let highestRank = 0;

  limits.forEach((lim) => {
    const prevRank = STATUS_ORDER[lim.prevStatus];
    const currRank = STATUS_ORDER[lim.currStatus];

    // Status must go UP and be caution, close, or reached
    if (currRank > prevRank && currRank > 0) {
      const token = `${lim.type}:${lim.currStatus}`;

      // Check if already shown today
      if (!currentShown.includes(token)) {
        if (currRank > highestRank) {
          highestRank = currRank;
          highestAlert = {
            limitType: lim.type,
            level: lim.currStatus,
            usedPct: lim.usedPct,
          };
        }
      }
    }
  });

  const updatedLog = { ...toastLog };

  if (highestAlert) {
    const token = `${(highestAlert as PropToastAlert).limitType}:${(highestAlert as PropToastAlert).level}`;
    const newShown = Array.from(new Set([...currentShown, token]));
    updatedLog[account.id] = {
      dayKey: todayKey,
      shown: newShown,
    };
    savePropToastLog(updatedLog);
  } else if (!accountLog || accountLog.dayKey !== todayKey) {
    // Ensure log is updated with clean dayKey if missing or new day
    updatedLog[account.id] = {
      dayKey: todayKey,
      shown: currentShown,
    };
    savePropToastLog(updatedLog);
  }

  return { alert: highestAlert, updatedLog };
}
