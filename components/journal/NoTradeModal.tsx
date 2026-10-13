"use client";

import React, { useState, useEffect, useId } from "react";
import { NoTradeEntry, NoTradeReason, NO_TRADE_REASONS, Account } from "@/lib/journal/types";
import { INSTRUMENT_AUTOCOMPLETE } from "@/lib/journal/types";
import { normalizeInstrument } from "@/lib/journal/calc";
import { toDateKey } from "@/components/ui/forms/DateTimePicker";
import { Autocomplete, Button, DateTimePicker, Modal, Select, Textarea } from "@/components/ui";

interface NoTradeModalProps {
  isOpen: boolean;
  entry?: NoTradeEntry | null;
  accounts: Account[];
  onClose: () => void;
  onSave: (entry: NoTradeEntry) => void;
  dict: any;
}

const INSTRUMENT_PLACEHOLDER = `${INSTRUMENT_AUTOCOMPLETE[0]}, ${INSTRUMENT_AUTOCOMPLETE[5]}...`;

/** "No trade" entry: a setup was skipped on purpose (date, account, instrument, reason, note). */
export function NoTradeModal({ isOpen, entry, accounts, onClose, onSave, dict }: NoTradeModalProps) {
  const formId = useId();
  const [date, setDate] = useState<string>(entry?.date ? entry.date.split("T")[0] : toDateKey(new Date()));
  const [accountId, setAccountId] = useState<string>(entry?.accountId || "");
  const [instrument, setInstrument] = useState<string>(entry?.instrument || "");
  const [reason, setReason] = useState<NoTradeReason>(entry?.reason || "setup_incomplete");
  const [note, setNote] = useState<string>(entry?.note || "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDate(entry?.date ? entry.date.split("T")[0] : toDateKey(new Date()));
    setAccountId(entry?.accountId || "");
    setInstrument(entry?.instrument || "");
    setReason(entry?.reason || "setup_incomplete");
    setNote(entry?.note || "");
    setErrorMessage(null);
  }, [entry, isOpen]);

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={dict.journal.noTrade.title}
      subtitle={dict.journal.noTrade.subtitle}
      closeLabel={dict.journal.addTradeModal.closeLabel}
      data-testid="no-trade-modal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {dict.journal.cancel}
          </Button>
          <Button type="submit" form={formId}>
            {dict.journal.noTrade.saveBtn}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DateTimePicker mode="date" label={dict.journal.noTrade.dateLabel} value={date} onChange={(v) => v && setDate(v)} />
          <Select
            label={dict.journal.addTradeModal.accountLabel}
            optional
            value={accountId || "none"}
            onChange={(v) => setAccountId(v === "none" ? "" : v)}
            options={[
              { value: "none", label: `— ${dict.journal.tradesTab.filterAccount} —` },
              ...accounts
                .filter((a) => !a.archivedAt)
                .map((a) => ({ value: a.id, label: a.name || dict.journal.accountsTab.mainAccountDefaultName })),
            ]}
          />
        </div>
        <Autocomplete
          label={dict.journal.noTrade.instrumentLabel}
          optional
          value={instrument}
          onChange={(v) => setInstrument(v.toUpperCase())}
          suggestions={INSTRUMENT_AUTOCOMPLETE}
          placeholder={INSTRUMENT_PLACEHOLDER}
          inputClassName="uppercase font-semibold tracking-wide"
        />
        <Select
          label={dict.journal.noTrade.reasonLabel}
          value={reason}
          onChange={setReason}
          error={errorMessage ?? undefined}
          data-testid="no-trade-reason"
          options={NO_TRADE_REASONS.map((r) => ({ value: r as NoTradeReason, label: dict.journal.noTrade.reasons[r] || r }))}
        />
        <Textarea
          label={dict.journal.noTrade.noteLabel}
          optional
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          maxLength={500}
          placeholder={dict.journal.notesPlaceholder}
        />
      </form>
    </Modal>
  );
}
