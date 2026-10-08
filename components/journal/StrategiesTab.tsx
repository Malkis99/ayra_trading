"use client";

import React, { useState, useMemo } from "react";
import { Strategy, Trade } from "@/lib/journal/types";
import { STARTER_TEMPLATES, createStrategyFromTemplate, StarterTemplate } from "@/lib/journal/starter-templates";
import { StrategyModal } from "./StrategyModal";
import { GAME_CONFIG } from "@/lib/game-config";
import { Plus, Copy, Edit2, Archive, Trash2, ShieldCheck, Sparkles, AlertCircle } from "lucide-react";

interface StrategiesTabProps {
  strategies: Strategy[];
  trades: Trade[];
  onSaveStrategy: (strategy: Strategy) => void;
  onArchiveStrategy: (id: string) => void;
  onDeleteStrategy: (id: string) => void;
  dict: any;
  lang: "ru" | "en";
}

export function StrategiesTab({
  strategies,
  trades,
  onSaveStrategy,
  onArchiveStrategy,
  onDeleteStrategy,
  dict,
  lang,
}: StrategiesTabProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const activeStrategies = useMemo(
    () => strategies.filter((s) => !s.archivedAt),
    [strategies]
  );

  const archivedStrategies = useMemo(
    () => strategies.filter((s) => !!s.archivedAt),
    [strategies]
  );

  const handleOpenCreate = () => {
    if (activeStrategies.length >= GAME_CONFIG.MAX_ACTIVE_STRATEGIES) {
      alert(
        dict.journal.strategiesTab.maxActiveLimitReached.replace(
          "{max}",
          String(GAME_CONFIG.MAX_ACTIVE_STRATEGIES)
        )
      );
      return;
    }
    setEditingStrategy(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (strat: Strategy) => {
    setEditingStrategy(strat);
    setIsModalOpen(true);
  };

  const handleDuplicate = (strat: Strategy) => {
    if (activeStrategies.length >= GAME_CONFIG.MAX_ACTIVE_STRATEGIES) {
      alert(
        dict.journal.strategiesTab.maxActiveLimitReached.replace(
          "{max}",
          String(GAME_CONFIG.MAX_ACTIVE_STRATEGIES)
        )
      );
      return;
    }

    const copySuffixStr = dict.journal.strategiesTab.copySuffix;
    const copyName = strat.name
      ? `${strat.name} (${copySuffixStr})`
      : `${dict.journal.strategiesTab.defaultName} (${copySuffixStr})`;

    const duplicated: Strategy = {
      ...strat,
      id: `strat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: copyName,
      version: 1,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      rules: strat.rules.map((r) => ({
        ...r,
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      })),
    };

    onSaveStrategy(duplicated);
  };

  const handleUseTemplate = (tpl: StarterTemplate) => {
    if (activeStrategies.length >= GAME_CONFIG.MAX_ACTIVE_STRATEGIES) {
      alert(
        dict.journal.strategiesTab.maxActiveLimitReached.replace(
          "{max}",
          String(GAME_CONFIG.MAX_ACTIVE_STRATEGIES)
        )
      );
      return;
    }

    const newStrat = createStrategyFromTemplate(tpl, lang);
    onSaveStrategy(newStrat);
  };

  const handleDeleteConfirm = (id: string) => {
    try {
      onDeleteStrategy(id);
      setDeletingId(null);
    } catch {
      alert(dict.journal.strategiesTab.cannotDeleteHasTrades);
    }
  };

  // Compute mini-stats for a strategy
  const getStrategyStats = (stratId: string) => {
    const stratTrades = trades.filter(
      (t) => t.strategyId === stratId && t.status === "closed"
    );
    const count = stratTrades.length;

    if (count === 0) {
      return {
        count: 0,
        winrate: null,
        avgR: null,
        avgProcessScore: null,
        isSmallSample: true,
      };
    }

    const wins = stratTrades.filter((t) => t.result === "win").length;
    const winrate = Math.round((wins / count) * 100);

    const rSum = stratTrades.reduce(
      (acc, t) => acc + (typeof t.rMultiple === "number" ? t.rMultiple : 0),
      0
    );
    const avgR = Number((rSum / count).toFixed(2));

    const ratedTrades = stratTrades.filter(
      (t) => typeof t.processScore === "number"
    );
    const avgProcessScore =
      ratedTrades.length > 0
        ? Math.round(
            ratedTrades.reduce((acc, t) => acc + (t.processScore || 0), 0) /
              ratedTrades.length
          )
        : null;

    return {
      count,
      winrate,
      avgR,
      avgProcessScore,
      isSmallSample: count < GAME_CONFIG.JOURNAL_MIN_SAMPLE_SIZE,
    };
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-s2/40 p-4 border border-line rounded-xl">
        <div>
          <h3 className="font-bold text-sm text-tx">
            {dict.journal.strategiesTab.title}
          </h3>
          <p className="text-xs text-mu mt-0.5">
            {dict.journal.strategiesTab.subtitle} ({activeStrategies.length}/
            {GAME_CONFIG.MAX_ACTIVE_STRATEGIES})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {archivedStrategies.length > 0 && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="btn-ghost text-xs py-2 px-3"
            >
              {showArchived
                ? dict.journal.strategiesTab.hideArchived
                : `${dict.journal.strategiesTab.showArchived} (${archivedStrategies.length})`}
            </button>
          )}

          <button
            onClick={handleOpenCreate}
            disabled={activeStrategies.length >= GAME_CONFIG.MAX_ACTIVE_STRATEGIES}
            className="btn text-xs py-2 px-4 flex items-center gap-1.5 font-semibold disabled:opacity-50"
          >
            <Plus size={16} />
            <span>{dict.journal.strategiesTab.createBtn}</span>
          </button>
        </div>
      </div>

      {/* Empty State: Show Starter Templates */}
      {activeStrategies.length === 0 && !showArchived && (
        <div className="space-y-4">
          <div className="card text-center p-6 space-y-2 border-dashed">
            <Sparkles size={28} className="mx-auto text-vi" />
            <h3 className="h3">{dict.journal.strategiesTab.emptyTitle}</h3>
            <p className="text-xs text-mu max-w-md mx-auto">
              {dict.journal.strategiesTab.emptyDesc}
            </p>
            <button
              onClick={handleOpenCreate}
              className="btn text-xs py-2 px-4 inline-flex items-center gap-1.5 font-semibold mt-2"
            >
              <Plus size={16} />
              <span>{dict.journal.strategiesTab.createBtn}</span>
            </button>
          </div>

          {/* Starter Templates Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-vi" />
              <h4 className="font-bold text-sm text-tx">
                {dict.journal.strategiesTab.starterTemplatesTitle}
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {STARTER_TEMPLATES.map((tpl) => {
                const name = lang === "ru" ? tpl.nameRu : tpl.nameEn;
                const desc = lang === "ru" ? tpl.descriptionRu : tpl.descriptionEn;
                const rules = lang === "ru" ? tpl.rulesRu : tpl.rulesEn;

                return (
                  <div
                    key={tpl.id}
                    className="card p-4 space-y-3 flex flex-col justify-between border-line hover:border-vi/50 transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full flex-none"
                            style={{ backgroundColor: tpl.color }}
                          />
                          <h5 className="font-bold text-sm text-tx">{name}</h5>
                        </div>
                        <span className="badge-free text-[10px] px-2 py-0.5">
                          {dict.journal.strategiesTab.exampleTag}
                        </span>
                      </div>

                      <p className="text-xs text-mu line-clamp-2">{desc}</p>

                      {/* Rule Previews */}
                      <div className="space-y-1.5 pt-1 border-t border-line/40 text-xs">
                        <span className="text-[11px] text-mu font-medium block">
                          {dict.journal.strategiesTab.rulesPreviewLabel}:
                        </span>
                        {rules.slice(0, 3).map((r, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-[11px] text-tx">
                            <span className="text-vi font-bold">•</span>
                            <span className="line-clamp-1 flex-1">{r.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => handleUseTemplate(tpl)}
                      className="btn-secondary text-xs py-2 px-3 w-full font-semibold flex items-center justify-center gap-1.5 mt-2"
                    >
                      <Copy size={14} />
                      <span>{dict.journal.strategiesTab.useTemplateBtn}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Active Strategies Cards Grid */}
      {activeStrategies.length > 0 && !showArchived && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeStrategies.map((strat) => {
            const stats = getStrategyStats(strat.id);
            const tradeCountForStrat = trades.filter((t) => t.strategyId === strat.id).length;

            return (
              <div
                key={strat.id}
                className="card p-4 space-y-3 relative border-line hover:border-vi/40 transition-colors flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  {/* Header: Color, Name, Version */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full flex-none"
                        style={{ backgroundColor: strat.color }}
                      />
                      <h4 className="font-bold text-sm text-tx">
                        {strat.name || dict.journal.strategiesTab.defaultName}
                      </h4>
                    </div>
                    <span className="text-[10px] text-mu font-semibold px-1.5 py-0.5 rounded bg-s2 border border-line">
                      v{strat.version}
                    </span>
                  </div>

                  {/* Description */}
                  {strat.description && (
                    <p className="text-xs text-mu line-clamp-2">{strat.description}</p>
                  )}

                  {/* Tags */}
                  {strat.tags && strat.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {strat.tags.map((t) => (
                        <span key={t} className="chip text-[10px] py-0.5 px-1.5">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Rules Count & Session Info */}
                  <div className="flex items-center justify-between text-xs text-mu border-t border-line/40 pt-2">
                    <span className="font-medium text-tx">
                      {strat.rules.length} {dict.journal.strategiesTab.rulesCountLabel}
                    </span>
                    {strat.riskLimit && (
                      <span className="text-[11px] text-amber-300 font-medium">
                        {dict.journal.strategiesTab.riskLimitBadge}: {strat.riskLimit.value}{" "}
                        {strat.riskLimit.type === "r" ? "R" : "%"}
                      </span>
                    )}
                  </div>

                  {/* Mini-Stats Box */}
                  <div className="p-2.5 bg-s2/60 border border-line/60 rounded-xl space-y-1.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-mu block text-[10px]">
                          {dict.journal.strategiesTab.statTrades}:
                        </span>
                        <b className="text-tx">{stats.count}</b>
                      </div>

                      <div>
                        <span className="text-mu block text-[10px]">
                          {dict.journal.strategiesTab.statWinrate}:
                        </span>
                        <b className="text-tx">
                          {stats.winrate != null ? `${stats.winrate}%` : "—"}
                        </b>
                      </div>

                      <div>
                        <span className="text-mu block text-[10px]">
                          {dict.journal.strategiesTab.statAvgR}:
                        </span>
                        <b className="text-tx">
                          {stats.avgR != null
                            ? `${stats.avgR > 0 ? "+" : ""}${stats.avgR} R`
                            : "—"}
                        </b>
                      </div>

                      <div>
                        <span className="text-mu block text-[10px]">
                          {dict.journal.strategiesTab.statAvgProcess}:
                        </span>
                        <b className="text-tx">
                          {stats.avgProcessScore != null
                            ? `${stats.avgProcessScore}/100`
                            : "—"}
                        </b>
                      </div>
                    </div>

                    {stats.isSmallSample && (
                      <div className="flex items-center gap-1 text-[10px] text-mu pt-1 border-t border-line/30">
                        <AlertCircle size={10} className="text-amber-400" />
                        <span>
                          {dict.journal.strategiesTab.smallSampleNotice.replace(
                            "{count}",
                            String(stats.count)
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-line/40">
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleOpenEdit(strat)}
                      className="btn-ghost py-1 px-2 text-xs flex items-center gap-1 text-tx"
                      title={dict.journal.strategiesTab.editBtn}
                    >
                      <Edit2 size={13} />
                      <span>{dict.journal.strategiesTab.editBtn}</span>
                    </button>
                    <button
                      onClick={() => handleDuplicate(strat)}
                      className="btn-ghost py-1 px-2 text-xs flex items-center gap-1 text-mu hover:text-tx"
                      title={dict.journal.strategiesTab.duplicateBtn}
                    >
                      <Copy size={13} />
                    </button>
                  </div>

                  <div className="flex gap-1">
                    <button
                      onClick={() => onArchiveStrategy(strat.id)}
                      className="btn-ghost py-1 px-2 text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      title={dict.journal.strategiesTab.archiveBtn}
                    >
                      <Archive size={13} />
                    </button>

                    {tradeCountForStrat === 0 && (
                      deletingId === strat.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDeleteConfirm(strat.id)}
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
                          onClick={() => setDeletingId(strat.id)}
                          className="btn-ghost py-1 px-2 text-xs text-rose-400 hover:text-rose-300"
                          title={dict.journal.strategiesTab.deleteBtn}
                        >
                          <Trash2 size={13} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Archived Strategies Section */}
      {showArchived && (
        <div className="space-y-3 pt-4 border-t border-line">
          <h4 className="font-bold text-sm text-mu">
            {dict.journal.strategiesTab.archivedSectionTitle}
          </h4>

          {archivedStrategies.length === 0 ? (
            <p className="text-xs text-mu">{dict.journal.strategiesTab.noArchived}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {archivedStrategies.map((strat) => (
                <div key={strat.id} className="card p-4 space-y-2 opacity-70">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-xs text-tx">
                      {strat.name || dict.journal.strategiesTab.defaultName}
                    </span>
                    <span className="badge-free text-[10px]">
                      {dict.journal.strategiesTab.archivedBadge}
                    </span>
                  </div>
                  <p className="text-xs text-mu">{strat.rules.length} {dict.journal.strategiesTab.rulesCountLabel}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      <StrategyModal
        isOpen={isModalOpen}
        strategy={editingStrategy}
        onClose={() => setIsModalOpen(false)}
        onSave={onSaveStrategy}
        dict={dict}
      />
    </div>
  );
}
