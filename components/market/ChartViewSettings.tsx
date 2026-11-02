"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { Button, Modal, cn } from "@/components/ui";
import { Segmented, Toggle } from "@/components/ui/forms/choice";
import { CLOCK_PLACES, DEFAULT_CHART_VIEW, type ChartView, type NotesPlace, type PanelSide } from "@/lib/market/chart-workspace";

/** «Set up the view» (PR 1.3b): the Watchlist panel, notes and the drawing toolbar — on / off and where. */
export function ChartViewSettings({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: ChartView; onChange: (next: ChartView) => void }) {
  const { dict } = useApp();
  const t = dict.market.chart.view;
  const set = (patch: Partial<ChartView>) => onChange({ ...value, ...patch });

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t.title}
      subtitle={t.deviceNote}
      closeLabel={t.close}
      size="sm"
      sheetOnMobile
      data-testid="market-chart-view"
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => onChange(DEFAULT_CHART_VIEW)} data-testid="market-chart-view-reset">
            {t.reset}
          </Button>
          <Button onClick={onClose} data-testid="market-chart-view-close">
            {t.close}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div data-testid="market-chart-view-watchlist">
          <Toggle label={t.watchlist} checked={value.watchlist} onChange={(watchlist) => set({ watchlist })} />
        </div>
        {value.watchlist && (
          <div data-testid="market-chart-view-side">
            <Segmented<PanelSide>
              label={t.side}
              options={[
                { value: "right", label: t.right },
                { value: "left", label: t.left },
              ]}
              value={value.watchlistSide}
              onChange={(watchlistSide) => set({ watchlistSide })}
            />
          </div>
        )}
        <div data-testid="market-chart-view-notes">
          <Toggle label={t.notes} checked={value.notes} onChange={(notes) => set({ notes })} />
        </div>
        {value.notes && (
          <div data-testid="market-chart-view-notes-place">
            <Segmented<NotesPlace>
              label={t.notesPlace}
              options={[
                { value: "below", label: t.below },
                { value: "side", label: t.sideNotes },
              ]}
              value={value.notesPlace}
              onChange={(notesPlace) => set({ notesPlace })}
            />
          </div>
        )}
        <div data-testid="market-chart-view-drawing">
          <Toggle label={t.drawing} description={t.drawingHint} checked={value.drawing} onChange={(drawing) => set({ drawing })} />
        </div>
        <fieldset className="space-y-1.5" data-testid="market-chart-view-clock">
          <legend className="text-sm font-medium text-tx">{t.clock}</legend>
          <p className="text-xs text-mu">{t.clockHint}</p>
          <div role="radiogroup" aria-label={t.clock} className="grid gap-1.5">
            {CLOCK_PLACES.map((place) => (
              <button
                key={place}
                type="button"
                role="radio"
                aria-checked={value.clock === place}
                onClick={() => set({ clock: place })}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                  value.clock === place ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-mu hover:text-tx"
                )}
                data-testid={`market-chart-view-clock-${place}`}
              >
                <span aria-hidden="true" className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", value.clock === place ? "border-vi" : "border-edge")}>
                  {value.clock === place && <span className="h-2 w-2 rounded-full bg-vi" />}
                </span>
                {t.clockPlaces[place]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
