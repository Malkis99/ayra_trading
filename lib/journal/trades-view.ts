import type { Account, Trade } from "./types";
import { sortTrades, type SortDir, type TradeSortKey } from "./overview";
import { getLocalDateString } from "./stats";

export const JOURNAL_TABS = ["dashboard", "trades", "plan", "notes", "reports", "strategies", "accounts"] as const;
export type JournalTab = typeof JOURNAL_TABS[number];
export function journalTab(value: string | null): JournalTab {
  if (value === "analytics") return "dashboard";
  return JOURNAL_TABS.includes(value as JournalTab) ? value as JournalTab : "dashboard";
}

export type TradeView = "list" | "days";
export type TradeDay = { dateKey: string; trades: Trade[] };

/** Group before pagination. Non-date sorts order trades within each local day. Never mutate records. */
export function tradeDays(trades: Trade[], tz: string, key: TradeSortKey, dir: SortDir, unit: "R" | "money" | "percent" = "R", accounts: Account[] = []): TradeDay[] {
  const days = new Map<string, Trade[]>();
  const amount = (t: Trade): { bucket: string; value: number } | null => {
    if (t.status !== "closed") return null;
    if (unit === "R" && finite(t.rMultiple)) return { bucket: "0:R", value: t.rMultiple };
    const account = accounts.find(a => a.id === t.accountId);
    if (!account || !finite(t.pnlMoney)) return null;
    if (unit === "percent") return finite(account.startBalance) && account.startBalance > 0 ? { bucket: "%", value: t.pnlMoney / account.startBalance * 100 } : null;
    return { bucket: `1:${account.currency}`, value: t.pnlMoney };
  };
  const sorted = key !== "result" ? sortTrades(trades, key, dir) : [...trades].sort((a, b) => {
    const x = amount(a), y = amount(b);
    if (!x || !y) return x ? -1 : y ? 1 : b.openedAt.localeCompare(a.openedAt);
    // Group unlike units/currencies, never compare their raw numerical values.
    return x.bucket.localeCompare(y.bucket) || (dir === "asc" ? 1 : -1) * (x.value - y.value) || b.openedAt.localeCompare(a.openedAt);
  });
  for (const trade of sorted) {
    const date = trade.openedAt || trade.createdAt;
    const day = Number.isFinite(Date.parse(date)) ? getLocalDateString(date, tz) : "unknown";
    const group = days.get(day) ?? [];
    group.push(trade); days.set(day, group);
  }
  return [...days].sort(([a], [b]) => (key === "date" && dir === "asc" ? 1 : -1) * a.localeCompare(b))
    .map(([dateKey, rows]) => ({ dateKey, trades: rows }));
}

/** A day is indivisible: a busy day may exceed the soft presentation page size. */
export function tradeDayPages(days: TradeDay[], size: number): TradeDay[][] {
  const pages: TradeDay[][] = []; let count = 0;
  for (const day of days) {
    if (!pages.length || count >= Math.max(1, size)) { pages.push([]); count = 0; }
    pages[pages.length - 1].push(day); count += day.trades.length;
  }
  return pages.length ? pages : [[]];
}

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
/** Read-only net results as stored: fees are already included; open rows never enter realised day totals. */
export function tradeDaySummary(trades: Trade[], accounts: Account[]) {
  const closed = trades.filter(t => t.status === "closed");
  const r = closed.filter(t => finite(t.rMultiple));
  const money = new Map<string, number>();
  let knownMoney = 0;
  for (const t of closed) {
    const account = accounts.find(a => a.id === t.accountId);
    if (account && finite(t.pnlMoney)) {
      money.set(account.currency, (money.get(account.currency) ?? 0) + t.pnlMoney); ++knownMoney;
    }
  }
  const used = accounts.filter(a => closed.some(t => t.accountId === a.id));
  const balances = used.map(a => a.startBalance);
  const base = balances.every(b => finite(b) && b > 0) ? balances.reduce<number>((s, b) => s + (b ?? 0), 0) : 0;
  const completeMoney = closed.length > 0 && knownMoney === closed.length;
  const percent = completeMoney && money.size === 1 && base > 0
    ? [...money.values()][0] / base * 100 : null;
  return {
    closed: closed.length, open: trades.length - closed.length,
    wins: closed.filter(t => t.result === "win").length,
    losses: closed.filter(t => t.result === "loss").length,
    breakeven: closed.filter(t => t.result === "breakeven").length,
    netR: r.length ? r.reduce((s, t) => s + t.rMultiple!, 0) : null,
    partialR: r.length > 0 && r.length < closed.length,
    money: [...money].map(([currency, value]) => ({ currency, value })),
    partialMoney: knownMoney < closed.length,
    percent,
  };
}
