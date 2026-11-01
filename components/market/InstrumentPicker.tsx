"use client";

import React, { useState } from "react";
import { Search } from "lucide-react";
import { useApp } from "@/lib/context";
import { Tabs, cn } from "@/components/ui";
import { PICKER_CATEGORIES, INSTRUMENT_IDS, INSTRUMENTS, type CategoryId, type InstrumentId, instrumentName } from "@/lib/market/instruments";

/**
 * Picks instruments from the Market catalog only (owner's decision 2026-11-01, kept for the wide catalog): the
 * categories (the five of the Overview and US stocks) as tabs and a search over names and tickers of the catalog. `selected` instruments are shown pressed; `disabled` ones cannot be picked.
 */
export function InstrumentPicker({
  idPrefix,
  selected,
  disabled = () => false,
  onPick,
  initialCategory = "forex",
}: {
  idPrefix: string;
  selected: (id: InstrumentId) => boolean;
  disabled?: (id: InstrumentId) => boolean;
  onPick: (id: InstrumentId) => void;
  initialCategory?: CategoryId;
}) {
  const { dict } = useApp();
  const t = dict.market;
  const [category, setCategory] = useState<CategoryId>(initialCategory);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const ids: readonly InstrumentId[] = q
    ? INSTRUMENT_IDS.filter((id) => instrumentName(id, t.instruments).toLowerCase().includes(q) || INSTRUMENTS[id].ticker.toLowerCase().includes(q))
    : (PICKER_CATEGORIES.find((c) => c.id === category) ?? PICKER_CATEGORIES[0]).ids;

  return (
    <div className="space-y-2" data-testid={`${idPrefix}-picker`}>
      <label className="relative block">
        <span className="sr-only">{t.chart.search}</span>
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mu" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.chart.search}
          className="w-full rounded-md border border-line bg-s1 py-2 pl-8 pr-3 text-sm text-tx placeholder:text-mu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          data-testid={`${idPrefix}-search`}
        />
      </label>
      {!q && (
        <Tabs<CategoryId>
          items={PICKER_CATEGORIES.map((c) => ({ id: c.id, label: t.overview.categories[c.id] }))}
          value={category}
          onChange={setCategory}
          label={t.chart.picker}
          idPrefix={`${idPrefix}-cat`}
        />
      )}
      {ids.length === 0 ? (
        <p className="py-2 text-xs text-mu" data-testid={`${idPrefix}-empty`}>
          {t.chart.searchEmpty}
        </p>
      ) : (
        <ul className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4" data-testid={`${idPrefix}-list`}>
          {ids.map((id) => {
            const on = selected(id);
            const off = !on && disabled(id);
            return (
              <li key={id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onPick(id)}
                  disabled={off}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full min-w-0 flex-col rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi motion-reduce:transition-none",
                    on ? "border-vi/70 bg-pri/25" : "border-line bg-s1 hover:border-vi/50",
                    off && "cursor-not-allowed opacity-50"
                  )}
                  data-testid={`${idPrefix}-pick-${id}`}
                >
                  <span className="truncate text-sm font-semibold text-tx">{instrumentName(id, t.instruments)}</span>
                  <span className="truncate text-[11px] text-mu">{INSTRUMENTS[id].ticker}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
