"use client";

import React from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatDate, formatString } from "@/lib/i18n";
import { cn } from "@/components/ui";
import { requestMarketSync, useMarketSyncStatus } from "@/lib/market/cloud-sync-engine";

/**
 * Where the Watchlist, notes and the chart settings are kept, and why when they are not in the account (owner
 * 2026-11-02: the sync must never fail silently). Nothing for guests. «Sync now» runs an exchange at once.
 */
export function MarketSyncLine({ className }: { className?: string }) {
  const { dict, lang } = useApp();
  const t = dict.market.sync;
  const s = useMarketSyncStatus();
  if (s.kind === "guest") return null;
  const ok = s.kind === "on";
  const text =
    s.kind === "on"
      ? s.lastSyncedAt
        ? formatString(t.on, { time: formatDate(lang, s.lastSyncedAt, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })
        : t.onNoTime
      : s.kind === "refused"
        ? formatString(t.refused, { detail: s.detail ?? "" })
        : t[s.kind];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]", ok ? "text-mu" : "text-tx", className)} role="status" data-testid="market-sync" data-kind={s.kind}>
      {ok ? <Cloud size={12} aria-hidden="true" className="text-vi" /> : <CloudOff size={12} aria-hidden="true" className="text-mu" />}
      <span className="min-w-0" data-testid="market-sync-text">
        {text}
      </span>
      <button
        type="button"
        onClick={() => requestMarketSync()}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-vi hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        data-testid="market-sync-now"
      >
        <RefreshCw size={11} aria-hidden="true" />
        {t.now}
      </button>
    </div>
  );
}
