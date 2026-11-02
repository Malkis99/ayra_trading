"use client";

import React, { useRef, useState } from "react";
import { Check, ChevronDown, Columns2, LayoutGrid, Square } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Popover, useOutsideClose } from "@/components/ui/forms/popover";
import { Toggle } from "@/components/ui/forms/choice";
import { cn } from "@/components/ui";
import { CHART_INTERVALS, categoryOf, instrumentName, INSTRUMENTS, type ChartInterval, type InstrumentId } from "@/lib/market/instruments";
import { LAYOUTS, type ChartLayout } from "@/lib/market/chart-layout";
import { InstrumentPicker } from "./InstrumentPicker";

const ICONS: Record<ChartLayout, React.ReactNode> = {
  1: <Square size={14} aria-hidden="true" />,
  2: <Columns2 size={14} aria-hidden="true" />,
  4: <LayoutGrid size={14} aria-hidden="true" />,
};

/** «Layout»: 1 / 2 / 4 charts (on phones 1 and 2) and «One instrument in all windows». */
export function LayoutMenu({
  layout,
  shown,
  narrow,
  link,
  onLayout,
  onLink,
}: {
  layout: ChartLayout;
  /** What is actually shown (on phones 4 shows as 2). */
  shown: ChartLayout;
  narrow: boolean;
  link: boolean;
  onLayout: (layout: ChartLayout) => void;
  onLink: (link: boolean) => void;
}) {
  const { dict } = useApp();
  const t = dict.market.chart.layout;
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
        aria-label={`${t.label}: ${t.options[shown]}`}
        title={t.label}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
          open || shown > 1 ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-tx hover:border-vi/50"
        )}
        data-testid="market-chart-layout"
        data-layout={shown}
      >
        {ICONS[shown]}
        <span className="hidden sm:inline">{t.options[shown]}</span>
      </button>
      {open && (
        <Popover anchor={button} open panelRef={panel} role="dialog" aria-label={t.label} minWidth={240} preferredHeight={320} className="max-w-[18rem]">
          <div className="space-y-2 p-2" data-testid="market-chart-layouts">
            <div role="radiogroup" aria-label={t.label} className="grid gap-0.5">
              {LAYOUTS.map((l) => {
                const off = narrow && l === 4;
                return (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={layout === l}
                    disabled={off}
                    onClick={() => onLayout(l)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40",
                      layout === l ? "bg-pri/25 text-tx" : "text-mu hover:bg-s2 hover:text-tx"
                    )}
                    data-testid={`market-chart-layout-${l}`}
                  >
                    {ICONS[l]}
                    <span className="flex-1">{t.options[l]}</span>
                    {layout === l && <Check size={14} aria-hidden="true" className="text-vi" />}
                  </button>
                );
              })}
            </div>
            {narrow && <p className="px-1 text-xs text-mu">{t.phoneNote}</p>}
            <div className="border-t border-line px-1 pt-1" data-testid="market-chart-layout-link">
              <Toggle label={t.link} description={t.linkHint} checked={link} onChange={onLink} />
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

/** The header of a window in layouts 2 and 4: its instrument (window 1 follows the toolbar) and its timeframe. */
export function PaneHeader({
  index,
  instrument,
  interval,
  favorites,
  locked,
  onInstrument,
  onInterval,
}: {
  index: number;
  instrument: InstrumentId;
  interval: ChartInterval;
  favorites: readonly ChartInterval[];
  /** Window 1, or «One instrument in all windows»: the instrument is not chosen here. */
  locked: boolean;
  onInstrument: (id: InstrumentId) => void;
  onInterval: (interval: ChartInterval) => void;
}) {
  const { dict } = useApp();
  const t = dict.market;
  const n = index + 1;
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const pickButton = useRef<HTMLButtonElement>(null);
  const pickPanel = useRef<HTMLDivElement>(null);
  const tfButton = useRef<HTMLButtonElement>(null);
  const tfPanel = useRef<HTMLDivElement>(null);
  useOutsideClose([pickButton, pickPanel], picking, () => setPicking(false));
  useOutsideClose([tfButton, tfPanel], choosing, () => setChoosing(false));
  const name = instrumentName(instrument, t.instruments);
  const intervals = CHART_INTERVALS.filter((i) => favorites.includes(i) || i === interval);

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-xs" data-testid={`market-chart-pane-${n}-header`}>
      {locked ? (
        <span className="min-w-0 truncate font-semibold text-tx" data-testid={`market-chart-pane-${n}-name`}>
          {name} <span className="font-normal text-mu">{INSTRUMENTS[instrument].ticker}</span>
        </span>
      ) : (
        <button
          ref={pickButton}
          type="button"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          aria-haspopup="dialog"
          aria-label={`${formatString(t.chart.layout.change, { n })}: ${name}`}
          className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-tx hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          data-testid={`market-chart-pane-${n}-change`}
        >
          <span className="truncate" data-testid={`market-chart-pane-${n}-name`}>
            {name}
          </span>
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-mu" />
        </button>
      )}
      <span className="ml-auto" />
      {index === 0 ? (
        <span className="tabular-nums text-mu">{t.chart.intervals[interval]}</span>
      ) : (
        <button
          ref={tfButton}
          type="button"
          onClick={() => setChoosing((v) => !v)}
          aria-expanded={choosing}
          aria-haspopup="dialog"
          aria-label={`${formatString(t.chart.layout.interval, { n })}: ${t.chart.intervals[interval]}`}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold tabular-nums text-tx hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          data-testid={`market-chart-pane-${n}-interval`}
        >
          {t.chart.intervals[interval]}
          <ChevronDown size={12} aria-hidden="true" className="text-mu" />
        </button>
      )}
      {picking && (
        <Popover anchor={pickButton} open panelRef={pickPanel} role="dialog" aria-label={formatString(t.chart.layout.change, { n })} minWidth={300} preferredHeight={460} className="max-w-[24rem]">
          <div className="p-3">
            <InstrumentPicker
              idPrefix={`market-chart-pane-${n}`}
              selected={(x) => x === instrument}
              onPick={(id) => {
                onInstrument(id);
                setPicking(false);
              }}
              initialCategory={categoryOf(instrument)}
            />
          </div>
        </Popover>
      )}
      {choosing && (
        <Popover anchor={tfButton} open panelRef={tfPanel} role="dialog" aria-label={formatString(t.chart.layout.interval, { n })} minWidth={160} preferredHeight={320} className="max-w-[12rem]">
          <div role="radiogroup" aria-label={formatString(t.chart.layout.interval, { n })} className="grid grid-cols-3 gap-1 p-2">
            {intervals.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={interval === i}
                onClick={() => {
                  onInterval(i);
                  setChoosing(false);
                }}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                  interval === i ? "bg-pri text-tx" : "text-mu hover:bg-s2 hover:text-tx"
                )}
                data-testid={`market-chart-pane-${n}-interval-${i}`}
              >
                {t.chart.intervals[i]}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
