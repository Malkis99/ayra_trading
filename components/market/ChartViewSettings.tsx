"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { Button, Modal } from "@/components/ui";
import { Segmented, Toggle } from "@/components/ui/forms/choice";
import { DEFAULT_CHART_VIEW, type ChartView, type NotesPlace, type PanelSide } from "@/lib/market/chart-workspace";

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
      </div>
    </Modal>
  );
}
