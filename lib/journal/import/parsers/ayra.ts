import type { Trade } from "../../types";
import type { ImportParser, NormalizedTrade, RowError } from "../types";

/** Highest AYRA trades export version this importer understands. */
export const AYRA_TRADES_MAX_VERSION = "1.3";

function versionAtMost(v: unknown, max: string): boolean {
  const a = String(v ?? "0").split(".").map(Number);
  const b = max.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return true;
}

/**
 * Trades from an AYRA JSON file: the trades export (kind "trades", ≤ 1.3) or a full profile export (journal.trades).
 * Soft-deleted records (deletedAt) are skipped, whatever the version.
 */
export function ayraTradesFrom(json: unknown): Trade[] | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.app !== "ayra") return null;
  if (o.kind === "trades") {
    if (!versionAtMost(o.exportVersion, AYRA_TRADES_MAX_VERSION)) return null;
    return Array.isArray(o.trades) ? (o.trades as Trade[]).filter((t) => !t?.deletedAt) : null;
  }
  const journal = o.journal as Record<string, unknown> | undefined;
  return journal && Array.isArray(journal.trades) ? (journal.trades as Trade[]).filter((t) => !t?.deletedAt) : null;
}

export const ayraParser: ImportParser = {
  id: "ayra",
  group: "other",
  kinds: ["json"],
  verification: "verified",
  detect: (t) => (t.kind === "json" && ayraTradesFrom(t.json) ? 1 : 0),
  parse(table) {
    const list = ayraTradesFrom(table.json) ?? [];
    const trades: NormalizedTrade[] = [];
    const errors: RowError[] = [];
    list.forEach((t, i) => {
      const n = i + 1;
      if (!t || typeof t !== "object") return errors.push({ row: n, code: "unsupportedRow" });
      if (!t.instrument) return errors.push({ row: n, code: "missingInstrument" });
      if (t.direction !== "long" && t.direction !== "short") return errors.push({ row: n, code: "missingDirection" });
      if (!t.openedAt || Number.isNaN(Date.parse(t.openedAt))) return errors.push({ row: n, code: "badTime" });
      trades.push({
        externalId: t.id,
        instrument: t.instrument,
        direction: t.direction,
        openedAt: new Date(t.openedAt).toISOString(),
        closedAt: t.closedAt ? new Date(t.closedAt).toISOString() : undefined,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        size: t.size,
        commission: t.fees,
        swap: t.swap,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
        notes: t.notes,
        // Keep every journal field (R, P&L, strategy, emotions, mistakes, checklist, score) as exported
        ayra: t as unknown as Record<string, unknown>,
        rows: [n],
      });
    });
    return { trades, errors };
  },
};
