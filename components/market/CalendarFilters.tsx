"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { cn } from "@/components/ui";
import {
  CALENDAR_COUNTRIES,
  DEFAULT_CALENDAR_NEWS,
  IMPORTANCE,
  toggleIn,
  type CalendarNewsPrefs,
  type Importance,
} from "@/lib/market/calendar-news";

/** Each importance has its own colour (a dot, and the border and tint when it is on). */
const LEVEL_TONE: Record<Importance, { dot: string; on: string }> = {
  high: { dot: "bg-short", on: "border-short/70 bg-short/15 text-tx" },
  medium: { dot: "bg-amber-300", on: "border-amber-300/70 bg-amber-300/15 text-tx" },
  low: { dot: "bg-mu", on: "border-mu/70 bg-mu/15 text-tx" },
};

const chip = "rounded-full border px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi";
const chipOff = "border-line text-mu hover:border-vi/50 hover:text-tx";

/**
 * The Calendar's filters (1.4b, owner 2026-11-03): two clear groups — importance in its own colours, countries with
 * «Select all» / «Reset» and the count — and one line saying what is chosen. On phones the countries fold into that
 * line («Countries · 4 of 10 · Change»), so the block stays small.
 */
export function CalendarFilters({ prefs, onChange }: { prefs: CalendarNewsPrefs; onChange: (next: CalendarNewsPrefs) => void }) {
  const { dict } = useApp();
  const t = dict.market.calendar;
  const [open, setOpen] = useState(false);
  const allOn = prefs.countries.length === CALENDAR_COUNTRIES.length;
  const isDefault = prefs.countries.join() === DEFAULT_CALENDAR_NEWS.countries.join();
  const summary = `${prefs.importance.map((i) => t.levels[i]).join(", ")} · ${prefs.countries.map((c) => t.countryNames[c]).join(", ")}`;

  return (
    <div className="rounded-xl border border-line bg-s1 p-3" data-testid="market-calendar-filters">
      <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:gap-6">
        <fieldset className="min-w-0 space-y-1.5" data-testid="market-calendar-importance">
          <legend className="sr-only">{t.importance}</legend>
          <div className="flex h-5 items-center text-[11px] font-semibold uppercase tracking-wide text-mu" aria-hidden="true">
            {t.importance}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {IMPORTANCE.map((i) => {
              const on = prefs.importance.includes(i);
              const last = on && prefs.importance.length === 1;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  title={last ? t.lastStays : undefined}
                  onClick={() => onChange({ ...prefs, importance: toggleIn(prefs.importance, i, IMPORTANCE) })}
                  className={cn(chip, "inline-flex items-center gap-1.5", on ? LEVEL_TONE[i].on : chipOff)}
                  data-testid={`market-calendar-importance-${i}`}
                  data-level={i}
                >
                  <span aria-hidden="true" className={cn("inline-block h-2 w-2 shrink-0 rounded-full", LEVEL_TONE[i].dot, !on && "opacity-50")} />
                  {t.levels[i]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="min-w-0 space-y-1.5" data-testid="market-calendar-countries">
          <legend className="sr-only">{t.countries}</legend>
          <div className="flex h-5 items-center gap-x-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-mu" aria-hidden="true">
              {t.countries}
            </span>
            <span className="text-[11px] tabular-nums text-mu" data-testid="market-calendar-countries-count">
              {formatString(t.countOf, { n: prefs.countries.length, total: CALENDAR_COUNTRIES.length })}
            </span>
            <span className="ml-auto inline-flex items-center gap-3 text-[11px] font-semibold">
              <span className={cn("items-center gap-3", open ? "inline-flex" : "hidden md:inline-flex")}>
              <button
                type="button"
                onClick={() => onChange({ ...prefs, countries: [...CALENDAR_COUNTRIES] })}
                disabled={allOn}
                className="text-vi hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-default disabled:text-mu/60 disabled:no-underline"
                data-testid="market-calendar-countries-all"
              >
                {t.selectAll}
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...prefs, countries: [...DEFAULT_CALENDAR_NEWS.countries] })}
                disabled={isDefault}
                title={t.resetHint}
                className="text-vi hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-default disabled:text-mu/60 disabled:no-underline"
                data-testid="market-calendar-countries-reset"
              >
                {t.reset}
              </button>
              </span>
              {/* phones: the chips fold away */}
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="market-calendar-country-list"
                className="inline-flex items-center gap-1 text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi md:hidden"
                data-testid="market-calendar-countries-toggle"
              >
                {open ? t.hide : t.change}
                <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
              </button>
            </span>
          </div>
          <div id="market-calendar-country-list" className={cn("flex-wrap gap-1.5", open ? "flex" : "hidden md:flex")} data-testid="market-calendar-country-list">
            {CALENDAR_COUNTRIES.map((c) => {
              const on = prefs.countries.includes(c);
              const last = on && prefs.countries.length === 1;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  title={last ? t.lastStays : undefined}
                  onClick={() => onChange({ ...prefs, countries: toggleIn(prefs.countries, c, CALENDAR_COUNTRIES) })}
                  className={cn(chip, on ? "border-vi/70 bg-pri/25 text-tx" : chipOff)}
                  data-testid={`market-calendar-country-${c}`}
                >
                  {t.countryNames[c]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <p className="mt-2.5 border-t border-line/60 pt-2 text-[11px] leading-snug text-mu" data-testid="market-calendar-summary">
        <span className="font-semibold text-tx">{t.chosen}</span> {summary}
      </p>
    </div>
  );
}
