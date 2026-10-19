import type { Trade } from "../types";
import { determineTradeResult, normalizeInstrument } from "../calc";
import type { ImportFormatId, NormalizedTrade } from "./types";
import { hashString } from "./util";

/** How R is calculated for imported trades. Without risk information R stays empty (never invented). */
export type RMode = "none" | "stopLoss" | "fixedRisk";

export interface ImportSettings {
  formatId: ImportFormatId;
  accountId: string;
  batchId: string;
  rMode: RMode;
  /** Risk per trade in account money for rMode "fixedRisk". */
  fixedRisk?: number;
  /** Strategy ids by lower-cased name from the file (existing strategies or ones the user agreed to create). */
  strategyIds?: Record<string, string>;
  nowIso: string;
}

const r6 = (n: number | null | undefined) => (n === undefined || n === null ? "" : String(Math.round(n * 1e6) / 1e6));

/** Name of a strategy from a file, as used for matching ("HTF FVG + CISD" = "htf fvg + cisd"). */
export const strategyNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

type ContentFields = Pick<Trade, "accountId" | "instrument" | "direction" | "openedAt"> &
  Partial<Pick<Trade, "closedAt" | "size" | "pnlMoney" | "fees" | "entryPrice" | "exitPrice">>;

/**
 * Content key of a trade without a ticket: account + instrument + direction + entry and exit minute + size + result
 * + commission (+ prices when known). Different trades with a different result never share a key.
 */
export function contentKey(t: ContentFields): string {
  const minute = (iso?: string) => (iso ? iso.slice(0, 16) : "");
  return `c:${hashString(
    [
      t.accountId,
      normalizeInstrument(t.instrument),
      t.direction,
      minute(t.openedAt),
      minute(t.closedAt),
      r6(t.size),
      r6(t.pnlMoney),
      r6(t.fees),
      r6(t.entryPrice),
      r6(t.exitPrice),
    ].join("|")
  )}`;
}

const isTicketKey = (key?: string) => Boolean(key) && !/^[hc]:/.test(key!);

/** Duplicate-protection key for an imported row: the platform ticket/ID when present, otherwise the content key. */
export function importKeyFor(formatId: ImportFormatId, t: NormalizedTrade, trade: ContentFields): string {
  if (t.externalId) return `${formatId}:${t.externalId}`;
  return contentKey(trade);
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Net result: platform profit minus commission plus swap (unless the file already gives a net value). */
export function netPnl(t: NormalizedTrade): number | undefined {
  if (t.profit === undefined) return undefined;
  if (t.profitIsNet) return roundTo(t.profit, 2);
  return roundTo(t.profit - (t.commission ?? 0) + (t.swap ?? 0), 2);
}

export function computeR(t: NormalizedTrade, pnl: number | undefined, s: Pick<ImportSettings, "rMode" | "fixedRisk">): number | undefined {
  if (s.rMode === "stopLoss") {
    if (t.entryPrice === undefined || t.exitPrice === undefined || !t.stopLoss) return undefined;
    const risk = Math.abs(t.entryPrice - t.stopLoss);
    if (!risk) return undefined;
    const dir = t.direction === "long" ? 1 : -1;
    return roundTo((dir * (t.exitPrice - t.entryPrice)) / risk, 2);
  }
  if (s.rMode === "fixedRisk") {
    if (pnl === undefined || !s.fixedRisk || s.fixedRisk <= 0) return undefined;
    return roundTo(pnl / s.fixedRisk, 2);
  }
  return undefined;
}

/** Win / loss / breakeven from the file's outcome when there is neither a result nor R (e.g. "TP" without P&L). */
function resultFromOutcome(outcome: NormalizedTrade["outcome"]): Trade["result"] | undefined {
  return outcome === "tp" ? "win" : outcome === "sl" ? "loss" : outcome === "be" ? "breakeven" : undefined;
}

/** Builds a journal trade from an imported row. Imported trades earn no XP and keep no attachments. */
export function buildTrade(t: NormalizedTrade, s: ImportSettings, index: number): Trade {
  if (s.formatId === "ayra" && t.ayra) {
    const original = t.ayra as unknown as Trade;
    return {
      ...original,
      id: original.id || `tr_imp_${s.batchId}_${index}`,
      accountId: s.accountId,
      attachmentIds: [],
      importBatchId: s.batchId,
      importKey: importKeyFor(s.formatId, t, { ...original, accountId: s.accountId }),
      externalId: original.externalId ?? original.id,
      updatedAt: s.nowIso,
    };
  }
  const pnlMoney = netPnl(t);
  // R from the file (e.g. an "RR" column) wins; otherwise calculated as chosen in the settings, never invented
  const rMultiple = t.rMultiple ?? computeR(t, pnlMoney, s);
  // Closed = the file gives a result: P&L, an outcome (TP/SL) or an exit price. Dates alone do not close a trade.
  const closed = pnlMoney !== undefined || t.outcome !== undefined || t.exitPrice !== undefined;
  const instrument = normalizeInstrument(t.instrument);
  const closedAt = closed ? t.closedAt ?? t.openedAt : undefined;
  const result =
    pnlMoney === undefined && rMultiple === undefined
      ? resultFromOutcome(t.outcome) ?? "breakeven"
      : determineTradeResult({ pnlMoney: pnlMoney ?? null, rMultiple: rMultiple ?? null });
  const strategyId = t.strategyName ? s.strategyIds?.[strategyNameKey(t.strategyName)] ?? null : null;
  const trade: Trade = {
    id: `tr_imp_${s.batchId}_${index}`,
    accountId: s.accountId,
    instrument,
    direction: t.direction,
    status: closed ? "closed" : "open",
    openedAt: t.openedAt,
    closedAt,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    size: t.size,
    fees: t.commission,
    swap: t.swap,
    riskAmount: s.rMode === "fixedRisk" && s.fixedRisk ? s.fixedRisk : undefined,
    riskPercent: t.riskPercent,
    pnlMoney,
    rMultiple,
    result,
    outcome: t.outcome,
    session: t.session,
    strategyId,
    strategyVersion: null,
    ruleChecks: {},
    emotions: [],
    mistakes: [],
    notes: t.notes,
    verification: "imported",
    source: "import",
    processScore: null,
    processScoreSnapshot: null,
    attachmentIds: [],
    importBatchId: s.batchId,
    externalId: t.externalId,
    createdAt: s.nowIso,
    updatedAt: s.nowIso,
    schemaVersion: 3,
  };
  trade.importKey = importKeyFor(s.formatId, t, trade);
  return trade;
}

export type PreviewStatus = "new" | "duplicate" | "duplicateInFile";

/**
 * Why a row is a duplicate (shown in the preview):
 * - ticket: a trade with the same ticket / ID is already in the journal
 * - ticketInFile: the same ticket appears earlier in this file
 * - content: the same trade (account, instrument, direction, entry and exit, size, result, commission) is in the journal
 */
export type DuplicateReason = "ticket" | "ticketInFile" | "content";

export interface PreviewRow {
  index: number;
  source: NormalizedTrade;
  trade: Trade;
  status: PreviewStatus;
  reason?: DuplicateReason;
  /** No result in the file (no P&L, no outcome): imported as an open trade. */
  open: boolean;
}

/**
 * Builds trades and marks duplicates. A trade with a ticket is a duplicate of the same ticket; any trade is a
 * duplicate of an identical trade already in the journal (one journal trade covers one file row — counted, so two
 * identical rows against one journal trade give one duplicate and one new trade). Identical rows without a ticket are
 * separate trades, never "repeated in file". Re-importing the same file therefore adds nothing.
 */
export function buildPreview(rows: NormalizedTrade[], existing: Trade[], s: ImportSettings): PreviewRow[] {
  const tickets = new Set<string>();
  const pool = new Map<string, number>();
  for (const t of existing) {
    if (t.deletedAt) continue;
    if (isTicketKey(t.importKey)) tickets.add(t.importKey!);
    tickets.add(`id:${t.id}`);
    const k = contentKey(t);
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  const takeFromPool = (k: string) => {
    const n = pool.get(k) ?? 0;
    if (n <= 0) return false;
    pool.set(k, n - 1);
    return true;
  };
  const seenTickets = new Set<string>();
  return rows.map((source, index) => {
    const trade = buildTrade(source, s, index);
    const open = trade.status === "open";
    const ticket = isTicketKey(trade.importKey) ? trade.importKey! : null;
    const ticketKeys = ticket ? [ticket, ...(s.formatId === "ayra" ? [`id:${trade.id}`] : [])] : [];
    let status: PreviewStatus = "new";
    let reason: DuplicateReason | undefined;
    if (ticketKeys.some((k) => tickets.has(k))) {
      status = "duplicate";
      reason = "ticket";
    } else if (ticket && seenTickets.has(ticket)) {
      status = "duplicateInFile";
      reason = "ticketInFile";
    } else if (takeFromPool(contentKey(trade))) {
      status = "duplicate";
      reason = "content";
    }
    if (ticket) seenTickets.add(ticket);
    return { index, source, trade, status, reason, open };
  });
}
