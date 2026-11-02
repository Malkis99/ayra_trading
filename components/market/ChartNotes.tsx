"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatDate, formatString } from "@/lib/i18n";
import { cn } from "@/components/ui";
import { NOTE_LIMIT, noteText, withNote, type ChartNotes as Notes } from "@/lib/market/chart-workspace";
import { instrumentName, type InstrumentId } from "@/lib/market/instruments";
import { useMarketInAccount } from "@/lib/market/cloud-sync-engine";

/**
 * A note on the instrument under (or beside) the chart (PR 1.3b). Saved on this device as it is typed; one note per
 * instrument. Gives no XP or coins. Later it may go to the Journal's «Notes» (see the PR).
 */
export function ChartNotes({ id, notes, onChange, className }: { id: InstrumentId; notes: Notes; onChange: (next: Notes) => void; className?: string }) {
  const { dict, lang } = useApp();
  const t = dict.market;
  const note = notes[id];
  const text = noteText(notes, id);
  const inAccount = useMarketInAccount();
  const label = formatString(t.chart.notes.title, { name: instrumentName(id, t.instruments) });

  return (
    <section className={cn("flex min-h-0 flex-col gap-1.5 rounded-xl border border-line bg-s1 p-3", className)} aria-label={label} data-testid="market-chart-notes">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="market-chart-note" className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-mu">
          {label}
        </label>
        {text && (
          <button type="button" onClick={() => onChange(withNote(notes, id, "", new Date()))} className="text-[11px] font-semibold text-mu hover:text-tx" data-testid="market-chart-note-clear">
            {t.chart.notes.clear}
          </button>
        )}
      </div>
      <textarea
        id="market-chart-note"
        value={text}
        maxLength={NOTE_LIMIT}
        onChange={(e) => onChange(withNote(notes, id, e.target.value, new Date()))}
        placeholder={t.chart.notes.placeholder}
        rows={3}
        className="min-h-[4.5rem] w-full flex-1 resize-y rounded-md border border-edge bg-field px-3 py-2 text-sm text-tx placeholder:text-mu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        data-testid="market-chart-note"
      />
      <div className="flex justify-between gap-2 text-[11px] text-mu">
        <span data-testid="market-chart-note-saved">
          {note && text ? formatString(inAccount ? t.chart.notes.savedAccount : t.chart.notes.saved, { time: formatDate(lang, Date.parse(note.updatedAt), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) }) : ""}
        </span>
        <span className="tabular-nums">{formatString(t.chart.notes.counter, { n: text.length, max: NOTE_LIMIT })}</span>
      </div>
    </section>
  );
}
