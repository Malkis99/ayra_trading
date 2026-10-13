"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { Account, Note, Strategy, Trade } from "@/lib/journal/types";
import {
  exportFileName,
  tableToCsv,
  tableToXlsx,
  tradesToJson,
  tradesToTable,
  type ExportColumn,
  type ExportFormat,
} from "@/lib/journal/export";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Button, Checkbox, ChipMultiSelect, DateTimePicker, Modal, Segmented, toDateKey } from "@/components/ui";

type Scope = "all" | "filtered" | "period" | "accounts";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  trades: Trade[];
  /** Trades currently visible in the trades table (its filters). */
  filteredTrades: Trade[];
  accounts: Account[];
  strategies: Strategy[];
  notes: Note[];
};

function download(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export trades as CSV (UTF-8 BOM), XLSX or AYRA JSON v1.2; screenshots are never exported. */
export function ExportDialog({ isOpen, onClose, trades, filteredTrades, accounts, strategies, notes }: Props) {
  const { dict, showToast } = useApp();
  const t = dict.journal.importExport.export;
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scope, setScope] = useState<Scope>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [includeNotes, setIncludeNotes] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const now = new Date();
    setTo(toDateKey(now));
    setFrom(toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
    setAccountIds(accounts.map((a) => a.id));
  }, [isOpen, accounts]);

  const selected = useMemo(() => {
    let list = scope === "filtered" ? filteredTrades : trades;
    if (scope === "period") {
      list = list.filter((tr) => {
        const d = toDateKey(new Date(tr.openedAt));
        return (!from || d >= from) && (!to || d <= to);
      });
    }
    if (scope === "accounts") list = list.filter((tr) => accountIds.includes(tr.accountId));
    return [...list].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  }, [scope, trades, filteredTrades, from, to, accountIds]);

  const doExport = () => {
    const name = exportFileName(format);
    if (format === "json") {
      download(name, tradesToJson(selected, { accounts, strategies, notes }, includeNotes), "application/json");
    } else {
      const table = tradesToTable(selected, {
        accounts,
        strategies,
        includeNotes,
        labels: {
          column: (c: ExportColumn) => t.columns[c],
          direction: (d) => (d === "long" ? dict.journal.addTradeModal.directionLong : dict.journal.addTradeModal.directionShort),
          mistake: (id) => dict.journal.mistakes[id as keyof typeof dict.journal.mistakes] ?? id,
          ruleCheck: (v) => (v === "passed" ? dict.journal.addTradeModal.rulePassed : v === "failed" ? dict.journal.addTradeModal.ruleFailed : dict.journal.addTradeModal.ruleNA),
          defaultAccount: dict.journal.accountsTab.mainAccountDefaultName,
          defaultStrategy: dict.journal.strategiesTab.defaultName,
        },
      });
      if (format === "csv") download(name, tableToCsv(table), "text/csv;charset=utf-8");
      else download(name, tableToXlsx(table) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    showToast(formatString(t.downloadedToast, { name }));
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t.title}
      closeLabel={dict.journal.importExport.close}
      size="md"
      sheetOnMobile
      data-testid="export-dialog"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm text-mu" aria-live="polite" data-testid="export-count">
            {selected.length ? formatString(t.count, { count: selected.length }) : t.empty}
          </span>
          <Button onClick={doExport} disabled={selected.length === 0} data-testid="export-download">
            <Download size={16} aria-hidden="true" />
            {t.download}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Segmented<ExportFormat>
          label={t.format}
          value={format}
          onChange={setFormat}
          hint={t.formatHint[format]}
          options={(["csv", "xlsx", "json"] as ExportFormat[]).map((f) => ({ value: f, label: t.formats[f], tone: "neutral" }))}
        />
        <Segmented<Scope>
          label={t.scope}
          value={scope}
          onChange={setScope}
          hint={scope === "filtered" ? t.filteredHint : undefined}
          options={(["all", "filtered", "period", "accounts"] as Scope[]).map((s) => ({ value: s, label: t.scopes[s], tone: "neutral" }))}
        />
        {scope === "period" && (
          <div className="grid grid-cols-2 gap-3">
            <DateTimePicker mode="date" showNow={false} label={t.from} value={from} onChange={setFrom} />
            <DateTimePicker mode="date" showNow={false} label={t.to} value={to} onChange={setTo} />
          </div>
        )}
        {scope === "accounts" && (
          <ChipMultiSelect
            label={t.accounts}
            value={accountIds}
            onChange={setAccountIds}
            options={accounts.map((a) => ({ value: a.id, label: a.name || dict.journal.accountsTab.mainAccountDefaultName }))}
          />
        )}
        <Checkbox label={t.includeNotes} checked={includeNotes} onChange={setIncludeNotes} />
      </div>
    </Modal>
  );
}
