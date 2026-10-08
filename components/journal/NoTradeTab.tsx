"use client";

import React, { useState, useMemo } from "react";
import { NoTradeEntry, NoTradeReason, Account } from "@/lib/journal/types";
import { NoTradeModal } from "./NoTradeModal";
import { Plus, Edit2, Trash2, ShieldCheck, Filter } from "lucide-react";

interface NoTradeTabProps {
  noTrades: NoTradeEntry[];
  accounts: Account[];
  onSaveNoTrade: (entry: NoTradeEntry) => void;
  onDeleteNoTrade: (id: string) => void;
  dict: any;
  lang: "ru" | "en";
}

export function NoTradeTab({
  noTrades,
  accounts,
  onSaveNoTrade,
  onDeleteNoTrade,
  dict,
  lang,
}: NoTradeTabProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<NoTradeEntry | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<string>("all");
  const [filterReason, setFilterReason] = useState<string>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    const nowMs = Date.now();

    return noTrades
      .filter((e) => {
        if (filterReason !== "all" && e.reason !== filterReason) return false;

        if (filterPeriod !== "all") {
          const entryMs = new Date(e.date).getTime();
          const diffDays = (nowMs - entryMs) / (1000 * 60 * 60 * 24);
          if (filterPeriod === "7d" && diffDays > 7) return false;
          if (filterPeriod === "30d" && diffDays > 30) return false;
          if (filterPeriod === "90d" && diffDays > 90) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [noTrades, filterPeriod, filterReason]);

  const handleOpenAdd = () => {
    setEditingEntry(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (entry: NoTradeEntry) => {
    setEditingEntry(entry);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-mu">
            <Filter size={14} />
            <span className="font-semibold">{dict.journal.tradesTab.periodAll}:</span>
          </div>

          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            className="input text-xs"
          >
            <option value="all">{dict.journal.tradesTab.periodAll}</option>
            <option value="7d">{dict.journal.tradesTab.period7d}</option>
            <option value="30d">{dict.journal.tradesTab.period30d}</option>
            <option value="90d">{dict.journal.tradesTab.period90d}</option>
          </select>

          <select
            value={filterReason}
            onChange={(e) => setFilterReason(e.target.value)}
            className="input text-xs"
          >
            <option value="all">{dict.journal.noTrade.filterReasonAll}</option>
            {Object.keys(dict.journal.noTrade.reasons).map((r) => (
              <option key={r} value={r}>
                {dict.journal.noTrade.reasons[r]}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleOpenAdd}
          className="btn text-xs py-2 px-4 flex items-center gap-1.5 font-semibold flex-none self-start sm:self-auto"
        >
          <Plus size={16} />
          <span>{dict.journal.noTrade.addBtn}</span>
        </button>
      </div>

      {/* Empty State */}
      {filteredEntries.length === 0 ? (
        <div className="card text-center p-8 space-y-3 border-dashed">
          <ShieldCheck size={32} className="mx-auto text-vi" />
          <h3 className="h3">{dict.journal.noTrade.emptyTitle}</h3>
          <p className="text-xs text-mu max-w-md mx-auto">
            {dict.journal.noTrade.emptyDesc}
          </p>
          <button
            onClick={handleOpenAdd}
            className="btn text-xs py-2 px-4 inline-flex items-center gap-1.5 font-semibold mt-2"
          >
            <Plus size={16} />
            <span>{dict.journal.noTrade.addBtn}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredEntries.map((entry) => {
            const acc = accounts.find((a) => a.id === entry.accountId);
            const reasonText =
              dict.journal.noTrade.reasons[entry.reason] || entry.reason;

            return (
              <div
                key={entry.id}
                className="card p-4 space-y-2.5 border-line hover:border-vi/40 transition-colors flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-tx">
                        {new Date(entry.date).toLocaleDateString(
                          lang === "ru" ? "ru-RU" : "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          }
                        )}
                      </span>
                      {entry.instrument && (
                        <span className="font-bold text-xs px-2 py-0.5 rounded bg-s2 text-vi border border-vi/30">
                          {entry.instrument}
                        </span>
                      )}
                    </div>

                    {acc && (
                      <span className="text-[10px] text-mu font-medium px-1.5 py-0.5 bg-s2 rounded border border-line">
                        {acc.name || dict.journal.accountsTab.mainAccountDefaultName}
                      </span>
                    )}
                  </div>

                  {/* Reason Badge */}
                  <div>
                    <span className="px-2 py-1 rounded text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 inline-block">
                      🛡️ {reasonText}
                    </span>
                  </div>

                  {/* Note */}
                  {entry.note && (
                    <p className="text-xs text-tx bg-s2/40 p-2.5 rounded-lg border border-line/60 whitespace-pre-wrap">
                      {entry.note}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end items-center gap-2 pt-2 border-t border-line/40 text-xs">
                  <button
                    onClick={() => handleOpenEdit(entry)}
                    className="btn-ghost py-1 px-2 text-xs flex items-center gap-1 text-tx"
                  >
                    <Edit2 size={13} />
                    <span>{dict.journal.accountsTab.editBtn}</span>
                  </button>

                  {deletingId === entry.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          onDeleteNoTrade(entry.id);
                          setDeletingId(null);
                        }}
                        className="bg-rose-600 hover:bg-rose-500 text-white text-[10px] py-1 px-2 rounded font-bold"
                      >
                        {dict.journal.strategiesTab.deleteConfirmYes}
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="btn-ghost text-[10px] py-1 px-1.5"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(entry.id)}
                      className="btn-ghost py-1 px-2 text-xs text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Form */}
      <NoTradeModal
        isOpen={isModalOpen}
        entry={editingEntry}
        accounts={accounts}
        onClose={() => setIsModalOpen(false)}
        onSave={onSaveNoTrade}
        dict={dict}
      />
    </div>
  );
}
