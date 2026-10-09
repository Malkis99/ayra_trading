"use client";

import React, { useState, useEffect } from "react";
import { NoTradeEntry, NoTradeReason, NO_TRADE_REASONS, Account } from "@/lib/journal/types";
import { INSTRUMENT_AUTOCOMPLETE } from "@/lib/journal/types";
import { normalizeInstrument } from "@/lib/journal/calc";
import { ShieldAlert } from "lucide-react";

interface NoTradeModalProps {
  isOpen: boolean;
  entry?: NoTradeEntry | null;
  accounts: Account[];
  onClose: () => void;
  onSave: (entry: NoTradeEntry) => void;
  dict: any;
}

export function NoTradeModal({
  isOpen,
  entry,
  accounts,
  onClose,
  onSave,
  dict,
}: NoTradeModalProps) {
  const getCurrentLocalDateStr = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
  };

  const [date, setDate] = useState<string>(
    entry?.date ? entry.date.split("T")[0] : getCurrentLocalDateStr()
  );
  const [accountId, setAccountId] = useState<string>(entry?.accountId || "");
  const [instrument, setInstrument] = useState<string>(entry?.instrument || "");
  const [reason, setReason] = useState<NoTradeReason>(
    entry?.reason || "setup_incomplete"
  );
  const [note, setNote] = useState<string>(entry?.note || "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (entry) {
      setDate(entry.date ? entry.date.split("T")[0] : getCurrentLocalDateStr());
      setAccountId(entry.accountId || "");
      setInstrument(entry.instrument || "");
      setReason(entry.reason || "setup_incomplete");
      setNote(entry.note || "");
    }
  }, [entry]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!reason) {
      setErrorMessage(dict.journal.errorRequired);
      return;
    }

    const normInst = instrument.trim() ? normalizeInstrument(instrument) : null;

    const savedEntry: NoTradeEntry = {
      id: entry?.id || `nt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      accountId: accountId || null,
      instrument: normInst,
      reason,
      note: note.trim().slice(0, 500) || null,
      createdAt: entry?.createdAt || new Date().toISOString(),
    };

    onSave(savedEntry);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-md space-y-4 p-5 shadow-xl border border-line"
      >
        <div className="flex justify-between items-center border-b border-line pb-3">
          <div>
            <h3 className="h3">{dict.journal.noTrade.title}</h3>
            <p className="text-xs text-mu mt-0.5">{dict.journal.noTrade.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mu hover:text-tx text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <ShieldAlert size={16} className="flex-none" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Date & Account */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-mu block mb-1 font-medium">
              {dict.journal.noTrade.dateLabel}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input text-xs w-full"
            />
          </div>

          <div>
            <label className="text-xs text-mu block mb-1 font-medium">
              {dict.journal.addTradeModal.accountLabel}
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="input text-xs w-full"
            >
              <option value="">— {dict.journal.tradesTab.filterAccount} —</option>
              {accounts
                .filter((a) => !a.archivedAt)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || dict.journal.accountsTab.mainAccountDefaultName}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Instrument */}
        <div>
          <label className="text-xs text-mu block mb-1 font-medium">
            {dict.journal.noTrade.instrumentLabel}
          </label>
          <input
            type="text"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            placeholder="XAUUSD, EURUSD..."
            className="input text-xs w-full uppercase"
            list="notrade-instruments"
          />
          <datalist id="notrade-instruments">
            {INSTRUMENT_AUTOCOMPLETE.map((inst) => (
              <option key={inst} value={inst} />
            ))}
          </datalist>
        </div>

        {/* Reason */}
        <div>
          <label className="text-xs text-mu block mb-1 font-medium">
            {dict.journal.noTrade.reasonLabel} *
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as NoTradeReason)}
            className="input text-xs w-full"
          >
            {NO_TRADE_REASONS.map((r) => (
              <option key={r} value={r}>
                {dict.journal.noTrade.reasons[r] || r}
              </option>
            ))}
          </select>
        </div>

        {/* Note */}
        <div>
          <label className="text-xs text-mu block mb-1 font-medium">
            {dict.journal.noTrade.noteLabel}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder={dict.journal.notesPlaceholder}
            className="input text-xs w-full h-20 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost py-2 px-4 text-xs"
          >
            {dict.journal.cancel}
          </button>
          <button type="submit" className="btn-primary py-2 px-5 text-xs font-semibold">
            {dict.journal.noTrade.saveBtn}
          </button>
        </div>
      </form>
    </div>
  );
}
