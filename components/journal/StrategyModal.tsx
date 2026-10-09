"use client";

import React, { useState } from "react";
import { Strategy, StrategyRule, RuleGroup, RuleWeight, TradeSession } from "@/lib/journal/types";
import { GAME_CONFIG } from "@/lib/game-config";
import { Plus, Trash2, ArrowUp, ArrowDown, X, ShieldAlert } from "lucide-react";

const COLOR_PALETTE = [
  "#50348f", // AYRA Purple
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#06b6d4", // Cyan
];

const SESSIONS_LIST: TradeSession[] = ["asia", "london", "newyork", "overlap", "other"];

interface StrategyModalProps {
  isOpen: boolean;
  strategy?: Strategy | null;
  onClose: () => void;
  onSave: (strategy: Strategy) => void;
  dict: any;
}

export function StrategyModal({
  isOpen,
  strategy,
  onClose,
  onSave,
  dict,
}: StrategyModalProps) {
  const isEditing = !!strategy;

  const [name, setName] = useState<string>(strategy?.name || "");
  const [description, setDescription] = useState<string>(strategy?.description || "");
  const [color, setColor] = useState<string>(strategy?.color || COLOR_PALETTE[0]);
  const [rules, setRules] = useState<StrategyRule[]>(strategy?.rules ? [...strategy.rules] : []);
  const [tags, setTags] = useState<string[]>(strategy?.tags ? [...strategy.tags] : []);
  const [tagInput, setTagInput] = useState<string>("");

  const [hasRiskLimit, setHasRiskLimit] = useState<boolean>(!!strategy?.riskLimit);
  const [riskType, setRiskType] = useState<"r" | "percent">(strategy?.riskLimit?.type || "r");
  const [riskValue, setRiskValue] = useState<string>(
    strategy?.riskLimit?.value != null ? String(strategy.riskLimit.value) : "1"
  );

  const [allowedSessions, setAllowedSessions] = useState<TradeSession[]>(
    strategy?.allowedSessions ? [...strategy.allowedSessions] : []
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddRule = () => {
    if (rules.length >= GAME_CONFIG.MAX_RULES_PER_STRATEGY) {
      setErrorMessage(
        dict.journal.strategiesTab.maxRulesLimitReached.replace(
          "{max}",
          String(GAME_CONFIG.MAX_RULES_PER_STRATEGY)
        )
      );
      return;
    }

    const newRule: StrategyRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      group: "entry",
      text: "",
      weight: "required",
    };
    setRules([...rules, newRule]);
    setErrorMessage(null);
  };

  const handleRuleChange = (index: number, field: keyof StrategyRule, value: any) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], [field]: value };
    setRules(updated);
  };

  const handleMoveRule = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === rules.length - 1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const updated = [...rules];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setRules(updated);
  };

  const handleRemoveRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (tags.length >= 12) return;
    if (tags.includes(trimmed)) {
      setTagInput("");
      return;
    }
    setTags([...tags, trimmed.slice(0, 20)]);
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const toggleSession = (sess: TradeSession) => {
    if (allowedSessions.includes(sess)) {
      setAllowedSessions(allowedSessions.filter((s) => s !== sess));
    } else {
      setAllowedSessions([...allowedSessions, sess]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate rules
    for (const r of rules) {
      if (!r.text.trim()) {
        setErrorMessage(dict.journal.strategiesTab.emptyRuleTextError);
        return;
      }
    }

    const nextVersion = strategy ? strategy.version + 1 : 1;

    const savedStrategy: Strategy = {
      id: strategy?.id || `strat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || null,
      description: description.trim() || null,
      color,
      rules: rules.map((r) => ({ ...r, text: r.text.trim().slice(0, 120) })),
      tags,
      riskLimit: hasRiskLimit
        ? {
            type: riskType,
            value: parseFloat(riskValue) || 1,
          }
        : null,
      allowedSessions: allowedSessions.length > 0 ? allowedSessions : null,
      version: nextVersion,
      archivedAt: strategy?.archivedAt || null,
      createdAt: strategy?.createdAt || new Date().toISOString(),
    };

    onSave(savedStrategy);
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
        className="card w-full max-w-2xl space-y-4 p-5 shadow-2xl border border-line my-8"
      >
        <div className="flex justify-between items-center border-b border-line pb-3">
          <h3 className="h3">
            {isEditing
              ? dict.journal.strategiesTab.editStrategyTitle
              : dict.journal.strategiesTab.createStrategyTitle}
          </h3>
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

        {/* Basic Info: Name & Color */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs text-mu block mb-1 font-medium">
              {dict.journal.strategiesTab.nameLabel}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder={dict.journal.strategiesTab.namePlaceholder}
              className="input text-xs w-full"
            />
          </div>

          <div>
            <label className="text-xs text-mu block mb-1 font-medium">
              {dict.journal.strategiesTab.colorLabel}
            </label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    color === c ? "ring-2 ring-white scale-110" : "opacity-70 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-mu block mb-1 font-medium">
            {dict.journal.strategiesTab.descriptionLabel}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 500))}
            placeholder={dict.journal.strategiesTab.descriptionPlaceholder}
            className="input text-xs w-full h-16 resize-none"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs text-mu block mb-1 font-medium">
            {dict.journal.strategiesTab.tagsLabel}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder={dict.journal.strategiesTab.addTagPlaceholder}
              className="input text-xs flex-1"
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="btn-secondary text-xs px-3"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="chip text-[11px] py-0.5 px-2 bg-s2 border border-line flex items-center gap-1"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="text-mu hover:text-rose-400"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Risk Limit & Allowed Sessions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-s2/40 border border-line rounded-xl text-xs">
          {/* Risk Limit */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-medium text-tx cursor-pointer">
              <input
                type="checkbox"
                checked={hasRiskLimit}
                onChange={(e) => setHasRiskLimit(e.target.checked)}
                className="accent-vi"
              />
              <span>{dict.journal.strategiesTab.riskLimitEnable}</span>
            </label>
            {hasRiskLimit && (
              <div className="flex gap-2 items-center">
                <select
                  value={riskType}
                  onChange={(e) => setRiskType(e.target.value as "r" | "percent")}
                  className="input text-xs w-24"
                >
                  <option value="r">R</option>
                  <option value="percent">%</option>
                </select>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={riskValue}
                  onChange={(e) => setRiskValue(e.target.value)}
                  className="input text-xs w-28"
                />
              </div>
            )}
          </div>

          {/* Sessions */}
          <div className="space-y-1.5">
            <span className="font-medium text-tx block">
              {dict.journal.strategiesTab.allowedSessionsLabel}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SESSIONS_LIST.map((sess) => {
                const active = allowedSessions.includes(sess);
                return (
                  <button
                    key={sess}
                    type="button"
                    onClick={() => toggleSession(sess)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors border ${
                      active
                        ? "bg-vi text-white border-vi"
                        : "bg-s2 text-mu border-line hover:text-tx"
                    }`}
                  >
                    {dict.journal.sessions[sess] || sess}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rules Section */}
        <div className="space-y-2 pt-2 border-t border-line">
          <div className="flex justify-between items-center">
            <span className="font-bold text-xs text-tx">
              {dict.journal.strategiesTab.rulesTitle} ({rules.length}/{GAME_CONFIG.MAX_RULES_PER_STRATEGY})
            </span>
            <button
              type="button"
              onClick={handleAddRule}
              disabled={rules.length >= GAME_CONFIG.MAX_RULES_PER_STRATEGY}
              className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1 text-vi hover:text-vi/80 disabled:opacity-40"
            >
              <Plus size={14} />
              <span>{dict.journal.strategiesTab.addRuleBtn}</span>
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="text-xs text-mu italic py-3 text-center border border-dashed border-line/60 rounded-xl">
              {dict.journal.strategiesTab.noRulesAdded}
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {rules.map((rule, idx) => (
                <div
                  key={rule.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2 bg-s2/60 border border-line rounded-lg text-xs"
                >
                  {/* Reorder Buttons */}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveRule(idx, "up")}
                      className="p-1 text-mu hover:text-tx disabled:opacity-30"
                      title={dict.journal.strategiesTab.moveUp}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === rules.length - 1}
                      onClick={() => handleMoveRule(idx, "down")}
                      className="p-1 text-mu hover:text-tx disabled:opacity-30"
                      title={dict.journal.strategiesTab.moveDown}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>

                  {/* Group */}
                  <select
                    value={rule.group}
                    onChange={(e) => handleRuleChange(idx, "group", e.target.value as RuleGroup)}
                    className="input text-xs w-28 py-1"
                  >
                    <option value="entry">{dict.journal.strategiesTab.groupEntry}</option>
                    <option value="exit">{dict.journal.strategiesTab.groupExit}</option>
                    <option value="risk">{dict.journal.strategiesTab.groupRisk}</option>
                    <option value="management">{dict.journal.strategiesTab.groupManagement}</option>
                  </select>

                  {/* Rule Text */}
                  <input
                    type="text"
                    value={rule.text}
                    onChange={(e) => handleRuleChange(idx, "text", e.target.value.slice(0, 120))}
                    placeholder={dict.journal.strategiesTab.ruleTextPlaceholder}
                    className="input text-xs flex-1 w-full py-1"
                  />

                  {/* Weight */}
                  <select
                    value={rule.weight}
                    onChange={(e) => handleRuleChange(idx, "weight", e.target.value as RuleWeight)}
                    className="input text-xs w-28 py-1"
                  >
                    <option value="required">{dict.journal.strategiesTab.weightRequired}</option>
                    <option value="optional">{dict.journal.strategiesTab.weightOptional}</option>
                  </select>

                  {/* Delete Rule */}
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(idx)}
                    className="p-1 text-rose-400 hover:text-rose-300"
                    title={dict.journal.strategiesTab.deleteRule}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost py-2 px-4 text-xs"
          >
            {dict.journal.cancel}
          </button>
          <button type="submit" className="btn-primary py-2 px-5 text-xs font-semibold">
            {dict.journal.save}
          </button>
        </div>
      </form>
    </div>
  );
}
