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
  nowIso: string;
}

const r6 = (n: number | undefined) => (n === undefined ? "" : String(Math.round(n * 1e6) / 1e6));

/** Content key: instrument + opening minute + entry price + size + direction. */
export function contentKey(t: { instrument: string; openedAt: string; entryPrice?: number; size?: number; direction: string }): string {
  const minute = t.openedAt.slice(0, 16);
  return `h:${hashString([normalizeInstrument(t.instrument), minute, r6(t.entryPrice), r6(t.size), t.direction].join("|"))}`;
}

/** Duplicate-protection key for an imported row: the platform ticket/ID when present, otherwise the content key. */
export function importKeyFor(formatId: ImportFormatId, t: NormalizedTrade): string {
  if (t.externalId) return `${formatId}:${t.externalId}`;
  return contentKey(t);
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

/** Builds a journal trade from an imported row. Imported trades earn no XP and keep no attachments. */
export function buildTrade(t: NormalizedTrade, s: ImportSettings, index: number): Trade {
  const key = importKeyFor(s.formatId, t);
  if (s.formatId === "ayra" && t.ayra) {
    const original = t.ayra as unknown as Trade;
    return {
      ...original,
      id: original.id || `tr_imp_${s.batchId}_${index}`,
      accountId: s.accountId,
      attachmentIds: [],
      importBatchId: s.batchId,
      importKey: key,
      externalId: original.externalId ?? original.id,
      updatedAt: s.nowIso,
    };
  }
  const pnlMoney = netPnl(t);
  const rMultiple = computeR(t, pnlMoney, s);
  const closed = Boolean(t.closedAt || t.exitPrice !== undefined || pnlMoney !== undefined);
  return {
    id: `tr_imp_${s.batchId}_${index}`,
    accountId: s.accountId,
    instrument: normalizeInstrument(t.instrument),
    direction: t.direction,
    status: closed ? "closed" : "open",
    openedAt: t.openedAt,
    closedAt: closed ? t.closedAt ?? t.openedAt : undefined,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    size: t.size,
    fees: t.commission,
    swap: t.swap,
    riskAmount: s.rMode === "fixedRisk" && s.fixedRisk ? s.fixedRisk : undefined,
    pnlMoney,
    rMultiple,
    result: determineTradeResult({ pnlMoney: pnlMoney ?? null, rMultiple: rMultiple ?? null }),
    strategyId: null,
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
    importKey: key,
    externalId: t.externalId,
    createdAt: s.nowIso,
    updatedAt: s.nowIso,
    schemaVersion: 3,
  };
}

export type PreviewStatus = "new" | "duplicate" | "duplicateInFile";

export interface PreviewRow {
  index: number;
  source: NormalizedTrade;
  trade: Trade;
  status: PreviewStatus;
}

/**
 * Builds trades and marks duplicates: same import key / id as a trade already in the journal,
 * or the same row twice in this file. Re-importing the same file therefore adds nothing.
 */
export function buildPreview(rows: NormalizedTrade[], existing: Trade[], s: ImportSettings): PreviewRow[] {
  const known = new Set<string>();
  for (const t of existing) {
    if (t.importKey) known.add(t.importKey);
    known.add(`id:${t.id}`);
    known.add(contentKey(t));
  }
  const seen = new Set<string>();
  return rows.map((source, index) => {
    const trade = buildTrade(source, s, index);
    const keys = [trade.importKey!, contentKey(trade)];
    if (s.formatId === "ayra") keys.push(`id:${trade.id}`);
    let status: PreviewStatus = "new";
    if (keys.some((k) => known.has(k))) status = "duplicate";
    else if (keys.some((k) => seen.has(k))) status = "duplicateInFile";
    keys.forEach((k) => seen.add(k));
    return { index, source, trade, status };
  });
}
