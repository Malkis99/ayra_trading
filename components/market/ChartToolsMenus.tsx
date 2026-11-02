"use client";

import React, { useRef, useState } from "react";
import { Activity, CandlestickChart, Check } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Popover, useOutsideClose } from "@/components/ui/forms/popover";
import { cn } from "@/components/ui";
import { CHART_STYLES, INDICATORS, MAX_INDICATORS, toggleIndicator, type ChartStyle, type IndicatorId } from "@/lib/market/chart-tools";

const triggerClass = (on: boolean) =>
  cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
    on ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-tx hover:border-vi/50"
  );

/** «Chart type»: TradingView's chart styles that the widget takes (checked live). */
export function ChartTypeMenu({ value, onChange }: { value: ChartStyle; onChange: (style: ChartStyle) => void }) {
  const { dict } = useApp();
  const t = dict.market.chart.tools;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useOutsideClose([button, panel], open, () => setOpen(false));
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t.type}: ${t.styles[value]}`}
        title={t.type}
        className={triggerClass(open)}
        data-testid="market-chart-type"
      >
        <CandlestickChart size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{t.styles[value]}</span>
      </button>
      {open && (
        <Popover anchor={button} open panelRef={panel} role="dialog" aria-label={t.type} minWidth={220} preferredHeight={420} className="max-w-[16rem]">
          <div role="radiogroup" aria-label={t.type} className="grid gap-0.5 p-1.5" data-testid="market-chart-types">
            {CHART_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={value === style}
                onClick={() => {
                  onChange(style);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                  value === style ? "bg-pri/25 text-tx" : "text-mu hover:bg-s2 hover:text-tx"
                )}
                data-testid={`market-chart-type-${style}`}
              >
                {t.styles[style]}
                {value === style && <Check size={14} aria-hidden="true" className="text-vi" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** «Indicators»: our list (no «Technical ratings»), at most six at once; shown on the chart through `studies`. */
export function IndicatorsMenu({ value, onChange }: { value: readonly IndicatorId[]; onChange: (next: IndicatorId[]) => void }) {
  const { dict } = useApp();
  const t = dict.market.chart.tools;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useOutsideClose([button, panel], open, () => setOpen(false));
  const full = value.length >= MAX_INDICATORS;
  const group = (from: number, to: number, title: string) => (
    <div className="space-y-0.5">
      <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-mu">{title}</p>
      {INDICATORS.slice(from, to).map(({ id }) => {
        const on = value.includes(id);
        return (
          <button
            key={id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={!on && full}
            onClick={() => onChange(toggleIndicator(value, id))}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40",
              on ? "bg-pri/25 text-tx" : "text-mu hover:bg-s2 hover:text-tx"
            )}
            data-testid={`market-chart-indicator-${id}`}
          >
            {t.names[id]}
            {on && <Check size={14} aria-hidden="true" className="shrink-0 text-vi" />}
          </button>
        );
      })}
    </div>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t.indicators}
        className={triggerClass(open || value.length > 0)}
        data-testid="market-chart-indicators"
      >
        <Activity size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{t.indicators}</span>
        {value.length > 0 && <span className="tabular-nums text-vi" data-testid="market-chart-indicators-count">{value.length}</span>}
      </button>
      {open && (
        <Popover anchor={button} open panelRef={panel} role="dialog" aria-label={t.indicators} minWidth={260} preferredHeight={460} className="max-w-[20rem]">
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-1.5" data-testid="market-chart-indicators-list">
            <p className="px-3 pt-1 text-xs text-mu">{formatString(t.indicatorsHint, { n: MAX_INDICATORS })}</p>
            {group(0, 9, t.overlay)}
            {group(9, INDICATORS.length, t.pane)}
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-mu hover:bg-s2 hover:text-tx" data-testid="market-chart-indicators-clear">
                {t.clear}
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
