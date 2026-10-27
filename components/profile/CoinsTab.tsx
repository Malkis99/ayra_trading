"use client";

import React, { useState } from "react";
import { Coins } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { EmptyState, cn } from "@/components/ui";
import { SettingRow } from "@/components/ui/SettingRow";
import { formatDate, formatNumber, formatString } from "@/lib/i18n";
import type { CoinLogEntry } from "@/lib/game";

type Filter = "all" | CoinLogEntry["source"];

/**
 * «Coins»: the balance and the history of credits on this device since it is kept (owner decision 2026-10-27: nothing
 * else here; the explanations are kept for a future FAQ in docs/faq-coins-draft.md).
 */
export function CoinsTab() {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const t = dict.profile.coinsTab;
  const kinds = dict.chronicleEvents.firstActionKinds;
  const [filter, setFilter] = useState<Filter>("all");

  const log = gameState.coinLog || [];
  const shown = filter === "all" ? log : log.filter((e) => e.source === filter);
  const since = gameState.coinLogSince ? formatDate(lang, new Date(gameState.coinLogSince), { day: "numeric", month: "long", year: "numeric" }) : null;
  const what = (e: CoinLogEntry) =>
    e.source === "quest"
      ? formatString(t.historyQuest, { title: e.title })
      : e.source === "dailyReward"
        ? t.historyDaily
        : formatString(t.historyFirst, { what: kinds[e.kind] });

  return (
    <div className="space-y-6">
      <SettingRow title={t.balance} hint={t.deviceNote} hintLabel={dict.journalSettings.hintLabel} data-testid="coins-balance">
        <p className="flex items-center gap-2 font-serif text-3xl font-semibold tabular-nums text-tx">
          <Coins size={22} className="text-vi" aria-hidden="true" />
          <span data-testid="coins-balance-value">{formatNumber(lang, gameState.coins)}</span>
        </p>
      </SettingRow>

      <section className="space-y-3" data-testid="coins-history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-tx">{t.historyTitle}</h3>
          {/* chips that wrap on a phone (a segmented bar is too narrow for four labels at 360) */}
          <div role="radiogroup" aria-label={t.filterLabel} className="flex flex-wrap gap-2">
            {(
              [
                ["all", t.filterAll],
                ["quest", t.filterQuests],
                ["dailyReward", t.filterDaily],
                ["firstAction", t.filterFirst],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                  filter === value ? "border-vi/60 bg-pri/25 text-tx" : "border-line bg-s2/40 text-mu hover:text-tx"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {since && (
          <p className="text-xs text-mu" data-testid="coins-history-since">
            {formatString(t.historySince, { date: since })}
          </p>
        )}
        {shown.length === 0 ? (
          <EmptyState icon={<Coins size={18} />} title={t.historyEmpty} />
        ) : (
          <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-s1/50">
            {shown.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-testid="coins-history-item" data-source={e.source}>
                <div className="min-w-0">
                  <p className="truncate text-tx">{what(e)}</p>
                  <p className="text-xs text-mu">{formatDate(lang, new Date(e.at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-tx">+{formatNumber(lang, e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
