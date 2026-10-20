"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Edit2, Minus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { Note, Strategy, Trade } from "@/lib/journal/types";
import { getProcessScoreCategory } from "@/lib/journal/process-score";
import type { Dictionary } from "@/lib/i18n/types";
import { AttachmentManager } from "@/components/journal/AttachmentManager";
import { Button, Drawer } from "@/components/ui";
import { cn } from "@/components/ui/cn";

type Props = {
  trade: Trade | null;
  onClose: () => void;
  strategies: Strategy[];
  notes: Note[];
  readOnly: boolean;
  formatTradeValue: (t: Trade) => string;
  onEdit: (t: Trade) => void;
  onConfirmDelete: (t: Trade) => void;
  onRecalculate: (t: Trade) => void;
  onAddLinkedNote: (t: Trade) => void;
  onOpenNote: (n: Note) => void;
  /** The user added or deleted a screenshot here: store the new id list in the trade record (it syncs). */
  onScreenshotsChanged: (t: Trade, attachmentIds: string[]) => void;
  dict: Dictionary;
  lang: string;
};

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mu">{label}</dt>
      <dd className={cn("truncate text-sm font-semibold tabular-nums", tone ?? "text-tx")}>{value}</dd>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-tx">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Trade card in a drawer: result, prices, process score, checklist, psychology, notes, screenshots, linked notes. */
export function TradeQuickView({
  trade,
  onClose,
  strategies,
  notes,
  readOnly,
  formatTradeValue,
  onEdit,
  onConfirmDelete,
  onRecalculate,
  onAddLinkedNote,
  onScreenshotsChanged,
  onOpenNote,
  dict,
  lang,
}: Props) {
  const tt = dict.journal.tradesTab;
  const am = dict.journal.addTradeModal;
  const ov = dict.journal.overview;
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setConfirming(false), [trade?.id]);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (!trade) return null;

  const strat = strategies.find((s) => s.id === trade.strategyId);
  const psScore = trade.processScore ?? null;
  const psCategory = getProcessScoreCategory(psScore);
  const linked = notes.filter((n) => !n.archivedAt && n.links?.tradeId === trade.id);
  const resultTone = trade.result === "win" ? "text-long" : trade.result === "loss" ? "text-short" : "text-tx";
  const fmtDate = (iso?: string) =>
    iso ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
  const directionLabel = trade.direction === "long" ? am.directionLong : am.directionShort;

  const footer = readOnly ? undefined : confirming ? (
    <div className="space-y-3" role="alert">
      <p className="text-sm font-semibold text-tx">
        {tt.confirmDelete}
        <span className="mt-0.5 block text-xs font-normal text-mu">({dict.journal.attachments.deleteTradeConfirmWithScreenshots})</span>
      </p>
      <div className="flex gap-2">
        <Button variant="danger" className="flex-1" onClick={() => onConfirmDelete(trade)}>
          {tt.deleteConfirmYes}
        </Button>
        <Button ref={cancelRef} variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>
          {tt.cancelDelete}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex gap-2">
      <Button variant="secondary" className="flex-1" onClick={() => onEdit(trade)}>
        <Edit2 size={16} aria-hidden="true" />
        {tt.editTradeBtn}
      </Button>
      <Button variant="danger" onClick={() => setConfirming(true)}>
        <Trash2 size={16} aria-hidden="true" />
        {tt.deleteTradeBtn}
      </Button>
    </div>
  );

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={tt.viewTradeTitle}
      subtitle={`${trade.instrument} · ${directionLabel}`}
      closeLabel={am.closeLabel}
      footer={footer}
      width="md"
      data-testid="trade-quick-view"
    >
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3 rounded-lg bg-s2/60 p-4">
          <div>
            <div className="text-xs text-mu">{tt.colResult}</div>
            <div className={cn("text-2xl font-bold tabular-nums", resultTone)}>{formatTradeValue(trade)}</div>
          </div>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", trade.direction === "long" ? "bg-long/15 text-long" : "bg-short/15 text-short")}>
            {directionLabel}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label={am.openedAtLabel} value={fmtDate(trade.openedAt)} />
          <Stat label={am.closedAtLabel} value={fmtDate(trade.closedAt)} />
          {trade.entryPrice != null && <Stat label={am.entryPriceLabel} value={trade.entryPrice} />}
          {trade.entryPrice != null && <Stat label={am.exitPriceLabel} value={trade.exitPrice ?? "—"} />}
          {trade.entryPrice != null && <Stat label={am.stopLossLabel} value={trade.stopLoss ?? "—"} />}
          {trade.entryPrice != null && <Stat label={am.takeProfitLabel} value={trade.takeProfit ?? "—"} />}
          {trade.session && <Stat label={am.sessionLabel} value={dict.journal.sessions[trade.session]} />}
          {trade.executionRating ? <Stat label={am.executionRatingLabel} value={"★".repeat(trade.executionRating)} tone="text-amber-300" /> : null}
        </dl>

        {(strat || psScore != null) && (
          <Section title={dict.journal.strategyLabel}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {strat && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: strat.color }} aria-hidden="true" />}
                <span className="truncate font-semibold text-tx">{strat?.name || dict.journal.strategiesTab.defaultName}</span>
                <span className="rounded border border-line bg-s2 px-1.5 text-xs text-mu">v{trade.strategyVersion || strat?.version || 1}</span>
              </div>
              {psScore != null && (
                <div className="text-right">
                  <div className="text-xs text-mu">{dict.journal.processScoreLabel}</div>
                  <div className={cn("text-lg font-bold", psCategory === "good" ? "text-long" : psCategory === "bad" ? "text-short" : "text-amber-300")}>{psScore}/100</div>
                </div>
              )}
            </div>
            {trade.processScoreSnapshot && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                {trade.processScoreSnapshot.components.map((c) => (
                  <div key={c.key} className="rounded-md bg-s2/60 p-2">
                    <div className="capitalize text-mu">{c.key}</div>
                    <div className="font-semibold text-tx">
                      {c.score}% <span className="font-normal text-mu">({c.weight}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {trade.processScoreSnapshot && trade.processScoreSnapshot.mistakesPenalty > 0 && (
              <p className="text-xs text-short">
                {dict.journal.mistakesPenaltyLabel}: -{trade.processScoreSnapshot.mistakesPenalty}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs italic text-mu">{dict.journal.processScoreDisclaimer}</span>
              {!readOnly && (
                <Button variant="ghost" size="sm" onClick={() => onRecalculate(trade)}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {dict.journal.recalculateProcessBtn}
                </Button>
              )}
            </div>
            {strat && strat.rules.length > 0 && trade.ruleChecks && Object.keys(trade.ruleChecks).length > 0 && (
              <ul className="space-y-1.5" aria-label={ov.ruleChecklistTitle}>
                {strat.rules.map((rule) => {
                  const v = trade.ruleChecks?.[rule.id];
                  const Icon = v === "passed" ? Check : v === "failed" ? X : Minus;
                  return (
                    <li key={rule.id} className="flex items-start gap-2 text-sm">
                      <Icon
                        size={16}
                        aria-label={v === "passed" ? am.rulePassed : v === "failed" ? am.ruleFailed : am.ruleNA}
                        className={cn("mt-0.5 shrink-0", v === "passed" ? "text-long" : v === "failed" ? "text-short" : "text-mu")}
                      />
                      <span className="text-tx">{rule.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        )}

        {(trade.emotions.length > 0 || trade.mistakes.length > 0 || trade.entryReason) && (
          <Section title={am.sectionPsychology}>
            {trade.emotions.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-mu">{ov.emotionsTitle}</div>
                <div className="flex flex-wrap gap-1.5">
                  {trade.emotions.map((e) => (
                    <span key={e} className="rounded-full border border-vi/40 bg-vi/10 px-2.5 py-1 text-xs text-tx">
                      {dict.journal.emotions[e as keyof typeof dict.journal.emotions] ?? e}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {trade.mistakes.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-mu">{ov.mistakesTitle}</div>
                <div className="flex flex-wrap gap-1.5">
                  {trade.mistakes.map((m) => (
                    <span key={m} className="rounded-full border border-short/40 bg-short/10 px-2.5 py-1 text-xs text-short">
                      {dict.journal.mistakes[m as keyof typeof dict.journal.mistakes] ?? m}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {trade.entryReason && (
              <div className="space-y-1">
                <div className="text-xs text-mu">{ov.entryReasonTitle}</div>
                <p className="whitespace-pre-wrap text-sm text-tx">{trade.entryReason}</p>
              </div>
            )}
          </Section>
        )}

        {trade.notes && (
          <Section title={am.notesLabel}>
            <p className="whitespace-pre-wrap rounded-md bg-s2/60 p-3 text-sm text-tx">{trade.notes}</p>
          </Section>
        )}

        <Section title={dict.journal.attachments.title}>
          <AttachmentManager
            tradeId={trade.id}
            tradeOpenedAt={trade.openedAt}
            expectedIds={trade.attachmentIds}
            onPersistIds={readOnly ? undefined : (ids) => onScreenshotsChanged(trade, ids)}
          />
        </Section>

        <Section
          title={`${dict.journal.notes.linkedNotesTitle} (${linked.length})`}
          action={
            !readOnly && (
              <Button variant="ghost" size="sm" onClick={() => onAddLinkedNote(trade)}>
                <Plus size={14} aria-hidden="true" />
                {dict.journal.notes.addLinkedNoteBtn}
              </Button>
            )
          }
        >
          {linked.length > 0 && (
            <div className="space-y-2">
              {linked.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onOpenNote(n)}
                  className="block w-full rounded-md border border-line bg-s2/40 p-3 text-left hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                >
                  <div className="text-sm font-semibold text-tx">{n.title || n.body.split("\n")[0]}</div>
                  <p className="line-clamp-2 text-xs text-mu">{n.body}</p>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Drawer>
  );
}
