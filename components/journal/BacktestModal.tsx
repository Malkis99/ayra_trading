"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { FlaskConical, Trash2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { useJournal } from "@/lib/journal/context";
import { BACKTEST_TIMEFRAMES, type BacktestResult, type BacktestTimeframe, type Note } from "@/lib/journal/types";
import {
  BACKTEST_CONCLUSION_MIN,
  BACKTEST_INSTRUMENT_MAX,
  BACKTEST_MIN_SETUPS,
  BACKTEST_SETUP_MAX,
  readBacktest,
  validateBacktest,
  type BacktestError,
} from "@/lib/journal/backtest";
import { deviceDayKey } from "@/lib/day-key";
import { Modal } from "@/components/ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** A saved result to view and edit; absent: a new one. */
  initialNote?: Note | null;
}

type Form = { instrument: string; timeframe: BacktestTimeframe | ""; periodFrom: string; periodTo: string; setup: string; strategyId: string; setups: string; wins: string; losses: string; breakeven: string; avgWinR: string; avgLossR: string; conclusion: string };
const EMPTY: Form = { instrument: "", timeframe: "", periodFrom: "", periodTo: "", setup: "", strategyId: "", setups: "", wins: "", losses: "", breakeven: "", avgWinR: "", avgLossR: "", conclusion: "" };

/** A whole number from a field (empty → NaN, so «required» is caught); decimals stay decimals and fail the check. */
const int = (s: string) => (s.trim() === "" ? NaN : Number(s));
const optNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/**
 * The backtest result form (QH-6.1, docs/quest-hub-qh6-spec.md 4): a structured note of the journal. Nothing is given
 * for it here; the numbers must add up and the conclusion must be at least 60 characters before it can be saved.
 */
export function BacktestModal({ isOpen, onClose, initialNote }: Props) {
  const { dict, showToast } = useApp();
  const { strategies, saveNote, deleteNote } = useJournal();
  const t = dict.journal.backtest;
  const [form, setForm] = useState<Form>(EMPTY);
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errorsId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setTried(false);
    setConfirmDelete(false);
    const r = initialNote ? readBacktest(initialNote) : null;
    if (!initialNote) return setForm(EMPTY);
    setForm({
      instrument: r?.instrument || "",
      timeframe: r?.timeframe || "",
      periodFrom: r?.periodFrom || "",
      periodTo: r?.periodTo || "",
      setup: r?.setup || "",
      strategyId: r?.strategyId || "",
      setups: r ? String(r.setups) : "",
      wins: r ? String(r.wins) : "",
      losses: r ? String(r.losses) : "",
      breakeven: r ? String(r.breakeven) : "",
      avgWinR: r?.avgWinR != null ? String(r.avgWinR) : "",
      avgLossR: r?.avgLossR != null ? String(r.avgLossR) : "",
      conclusion: initialNote.body || "",
    });
  }, [isOpen, initialNote]);

  const result: Partial<BacktestResult> = useMemo(
    () => ({
      instrument: form.instrument.trim().toUpperCase(),
      timeframe: (form.timeframe || undefined) as BacktestTimeframe | undefined,
      periodFrom: form.periodFrom,
      periodTo: form.periodTo,
      setup: form.setup.trim(),
      strategyId: form.strategyId || null,
      setups: int(form.setups),
      wins: int(form.wins),
      losses: int(form.losses),
      breakeven: int(form.breakeven),
      avgWinR: optNum(form.avgWinR),
      avgLossR: optNum(form.avgLossR),
    }),
    [form]
  );
  const errors = useMemo(() => validateBacktest(result, form.conclusion, deviceDayKey(new Date())), [result, form.conclusion]);
  const show = (e: BacktestError) => tried && errors.includes(e);
  const message = (e: BacktestError) => formatString(t.errors[e], { min: e === "setupsMin" ? BACKTEST_MIN_SETUPS : BACKTEST_CONCLUSION_MIN });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickStrategy = (id: string) => {
    const s = strategies.find((x) => x.id === id);
    setForm((f) => ({ ...f, strategyId: id, setup: s?.name ? s.name.slice(0, BACKTEST_SETUP_MAX) : f.setup }));
  };

  const save = () => {
    setTried(true);
    if (errors.length > 0) return;
    const now = new Date().toISOString();
    const r = result as BacktestResult;
    const note: Note = {
      id: initialNote?.id || `note_bt_${Date.now()}`,
      title: `${r.instrument} ${r.timeframe}`,
      body: form.conclusion.trim().slice(0, 5000),
      tags: initialNote?.tags || [],
      pinned: initialNote?.pinned || false,
      links: { ...(initialNote?.links || {}), instrument: r.instrument, ...(r.strategyId ? { strategyId: r.strategyId } : {}) },
      templateKey: "backtest",
      backtest: { ...r, strategyId: r.strategyId || null },
      createdAt: initialNote?.createdAt || now,
      updatedAt: now,
      archivedAt: initialNote?.archivedAt || null,
    };
    saveNote(note);
    showToast(initialNote ? t.updated : t.saved);
    onClose();
  };

  const remove = () => {
    if (!initialNote) return;
    deleteNote(initialNote.id);
    showToast(t.deleted);
    onClose();
  };

  if (!isOpen) return null;
  const sum = [int(form.wins), int(form.losses), int(form.breakeven)].reduce((n, x) => n + (Number.isFinite(x) ? x : 0), 0);
  const field = "input w-full text-sm";
  const label = "mb-1 block text-xs font-semibold text-mu";
  const err = (e: BacktestError) =>
    show(e) && (
      <p className="mt-1 text-xs text-rose-300" data-testid={`backtest-error-${e}`}>
        {message(e)}
      </p>
    );
  const invalid = (...es: BacktestError[]) => (es.some(show) ? { "aria-invalid": true as const, "aria-describedby": errorsId } : {});

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      closeLabel={dict.journal.addTradeModal.closeLabel}
      data-testid="backtest-modal"
      title={
        <span className="flex items-center gap-2">
          <FlaskConical size={18} aria-hidden="true" className="text-vi" />
          {initialNote ? t.titleEdit : t.titleNew}
        </span>
      }
      subtitle={t.intro}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {initialNote ? (
            confirmDelete ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-tx">{t.deleteConfirm}</span>
                <button type="button" onClick={remove} className="btn-ghost min-h-[40px] px-3 text-xs text-rose-300" data-testid="backtest-delete-yes">
                  {t.deleteYes}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost min-h-[40px] px-3 text-xs">
                  {t.cancel}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost flex min-h-[40px] items-center gap-1 px-3 text-xs text-rose-300" data-testid="backtest-delete">
                <Trash2 size={14} aria-hidden="true" />
                {t.delete}
              </button>
            )
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost min-h-[40px] px-4 text-xs">
              {t.cancel}
            </button>
            <button type="button" onClick={save} className="btn-primary min-h-[40px] px-5 text-xs font-semibold" data-testid="backtest-save">
              {t.save}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {tried && errors.length > 0 && (
          <div role="alert" id={errorsId} className="rounded-xl border border-rose-400/40 bg-rose-400/[0.06] px-3 py-2 text-sm text-rose-200" data-testid="backtest-errors">
            <p className="font-semibold">{t.errorsTitle}</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {errors.map((e) => (
                <li key={e}>{message(e)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="bt-instrument">{t.instrument}</label>
            <input id="bt-instrument" className={field} maxLength={BACKTEST_INSTRUMENT_MAX} placeholder={t.instrumentPh} value={form.instrument} onChange={set("instrument")} data-testid="bt-instrument" {...invalid("instrument")} />
            {err("instrument")}
          </div>
          <div>
            <label className={label} htmlFor="bt-timeframe">{t.timeframe}</label>
            <select id="bt-timeframe" className={field} value={form.timeframe} onChange={set("timeframe")} data-testid="bt-timeframe" {...invalid("timeframe")}>
              <option value="">—</option>
              {BACKTEST_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
            {err("timeframe")}
          </div>
          <div>
            <label className={label} htmlFor="bt-from">{t.periodFrom}</label>
            <input id="bt-from" type="date" className={field} value={form.periodFrom} onChange={set("periodFrom")} data-testid="bt-from" {...invalid("periodFrom", "periodOrder")} />
            {err("periodFrom")}
            {err("periodOrder")}
          </div>
          <div>
            <label className={label} htmlFor="bt-to">{t.periodTo}</label>
            <input id="bt-to" type="date" className={field} value={form.periodTo} onChange={set("periodTo")} data-testid="bt-to" {...invalid("periodTo", "periodFuture")} />
            {err("periodTo")}
            {err("periodFuture")}
          </div>
        </div>

        <div>
          <label className={label} htmlFor="bt-setup">{t.setup}</label>
          <div className={strategies.length > 0 ? "grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]" : ""}>
            {strategies.length > 0 && (
              <select aria-label={t.setup} className={field} value={form.strategyId} onChange={(e) => pickStrategy(e.target.value)} data-testid="bt-strategy">
                <option value="">{t.strategyNone}</option>
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <input id="bt-setup" className={field} maxLength={BACKTEST_SETUP_MAX} placeholder={t.setupPh} value={form.setup} onChange={set("setup")} data-testid="bt-setup" {...invalid("setup")} />
          </div>
          {err("setup")}
        </div>

        <fieldset className="rounded-xl border border-line p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["setups", "wins", "losses", "breakeven"] as const).map((k) => (
              <div key={k}>
                <label className={label} htmlFor={`bt-${k}`}>{t[k]}</label>
                <input id={`bt-${k}`} type="number" inputMode="numeric" min={0} step={1} className={field} value={form[k]} onChange={set(k)} data-testid={`bt-${k}`} {...invalid("numbers", k === "setups" ? "setupsMin" : "sum")} />
              </div>
            ))}
          </div>
          <p className={`mt-2 text-xs ${tried && errors.includes("sum") ? "text-rose-300" : "text-mu"}`} data-testid="bt-sum">
            {formatString(t.sumHint, { sum, total: Number.isFinite(int(form.setups)) ? int(form.setups) : 0 })}
          </p>
          {err("numbers")}
          {err("setupsMin")}
          {err("sum")}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          {(["avgWinR", "avgLossR"] as const).map((k) => (
            <div key={k}>
              <label className={label} htmlFor={`bt-${k}`}>
                {t[k]} <span className="font-normal">· {t.optional}</span>
              </label>
              <input id={`bt-${k}`} inputMode="decimal" className={field} value={form[k]} onChange={set(k)} data-testid={`bt-${k}`} {...invalid("avgR")} />
            </div>
          ))}
        </div>
        {err("avgR")}

        <div>
          <label className={label} htmlFor="bt-conclusion">{t.conclusion}</label>
          <textarea id="bt-conclusion" rows={4} className={`${field} resize-y`} maxLength={5000} placeholder={t.conclusionPh} value={form.conclusion} onChange={set("conclusion")} data-testid="bt-conclusion" {...invalid("conclusion")} />
          <div className="mt-1 flex justify-between gap-2 text-xs text-mu">
            <span>{t.disclaimer}</span>
            <span data-testid="bt-counter">{formatString(t.counter, { n: form.conclusion.trim().length, min: BACKTEST_CONCLUSION_MIN })}</span>
          </div>
          {err("conclusion")}
        </div>
      </div>
    </Modal>
  );
}
