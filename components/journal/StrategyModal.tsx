"use client";

import React, { useState } from "react";
import { Strategy, StrategyRule, RuleGroup, RuleWeight, TradeSession } from "@/lib/journal/types";
import { GAME_CONFIG } from "@/lib/game-config";
import { Plus, Trash2, ArrowUp, ArrowDown, X, ShieldAlert, Check } from "lucide-react";
import { Button, ChipMultiSelect, Input, Modal, NumberInput, Segmented, Select, Textarea, Toggle } from "@/components/ui";

export const COLOR_PALETTE = [
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

  const formId = `strategy-form-${strategy?.id ?? "new"}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? dict.journal.strategiesTab.editStrategyTitle : dict.journal.strategiesTab.createStrategyTitle}
      closeLabel={dict.journal.addTradeModal.closeLabel}
      size="lg"
      data-testid="strategy-modal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {dict.journal.cancel}
          </Button>
          <Button type="submit" form={formId}>
            {dict.journal.save}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
        {errorMessage && (
          <p role="alert" className="flex items-center gap-2 rounded-md border border-short/40 bg-short/10 p-3 text-sm text-short">
            <ShieldAlert size={16} className="flex-none" aria-hidden="true" />
            <span>{errorMessage}</span>
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label={dict.journal.strategiesTab.nameLabel}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder={dict.journal.strategiesTab.namePlaceholder}
            containerClassName="sm:col-span-2"
          />
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-tx">{dict.journal.strategiesTab.colorLabel}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={dict.journal.strategiesTab.colorLabel}>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`grid h-9 w-9 place-items-center rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
                    color === c ? "scale-105 border-white" : "border-transparent opacity-75 hover:opacity-100"
                  }`}
                >
                  {color === c && <Check size={16} strokeWidth={3} className="text-white" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <Textarea
          label={dict.journal.strategiesTab.descriptionLabel}
          optional
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={2}
          placeholder={dict.journal.strategiesTab.descriptionPlaceholder}
        />

        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <Input
              label={dict.journal.strategiesTab.tagsLabel}
              optional
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder={dict.journal.strategiesTab.addTagPlaceholder}
              containerClassName="flex-1"
            />
            <Button variant="secondary" className="w-11 px-0" onClick={handleAddTag} aria-label={dict.journal.strategiesTab.addTagPlaceholder}>
              <Plus size={16} aria-hidden="true" />
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-vi/40 bg-vi/10 pl-3 pr-1 text-sm text-tx">
                  #{t}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    aria-label={`${dict.journal.strategiesTab.deleteRule}: #${t}`}
                    className="grid h-7 w-7 place-items-center rounded-full text-mu hover:bg-s2 hover:text-short"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-ink/40 p-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Toggle label={dict.journal.strategiesTab.riskLimitEnable} checked={hasRiskLimit} onChange={setHasRiskLimit} />
            {hasRiskLimit && (
              <div className="flex items-end gap-2">
                <Segmented<"r" | "percent">
                  name={dict.journal.strategiesTab.riskLimitEnable}
                  value={riskType}
                  onChange={setRiskType}
                  className="w-28"
                  options={[
                    { value: "r", label: "R", tone: "neutral" },
                    { value: "percent", label: "%", tone: "neutral" },
                  ]}
                />
                <NumberInput
                  aria-label={dict.journal.strategiesTab.riskLimitEnable}
                  unit={riskType === "r" ? "R" : "%"}
                  value={riskValue}
                  onChange={(e) => setRiskValue(e.target.value)}
                  containerClassName="flex-1"
                />
              </div>
            )}
          </div>
          <ChipMultiSelect
            label={dict.journal.strategiesTab.allowedSessionsLabel}
            value={allowedSessions}
            onChange={(v) => setAllowedSessions(v as TradeSession[])}
            options={SESSIONS_LIST.map((sess) => ({ value: sess, label: dict.journal.sessions[sess] || sess }))}
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-tx">
              {dict.journal.strategiesTab.rulesTitle} ({rules.length}/{GAME_CONFIG.MAX_RULES_PER_STRATEGY})
            </h3>
            <Button variant="ghost" size="sm" onClick={handleAddRule} disabled={rules.length >= GAME_CONFIG.MAX_RULES_PER_STRATEGY}>
              <Plus size={14} aria-hidden="true" />
              {dict.journal.strategiesTab.addRuleBtn}
            </Button>
          </div>

          {rules.length === 0 ? (
            <p className="rounded-md border border-dashed border-line py-4 text-center text-sm text-mu">{dict.journal.strategiesTab.noRulesAdded}</p>
          ) : (
            <ol className="space-y-2">
              {rules.map((rule, idx) => (
                <li key={rule.id} className="space-y-2 rounded-md border border-line bg-s2/40 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveRule(idx, "up")}
                        className="grid h-8 w-8 place-items-center rounded text-mu hover:bg-s2 hover:text-tx disabled:opacity-30"
                        aria-label={dict.journal.strategiesTab.moveUp}
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === rules.length - 1}
                        onClick={() => handleMoveRule(idx, "down")}
                        className="grid h-8 w-8 place-items-center rounded text-mu hover:bg-s2 hover:text-tx disabled:opacity-30"
                        aria-label={dict.journal.strategiesTab.moveDown}
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <Input
                      aria-label={dict.journal.strategiesTab.ruleTextPlaceholder}
                      value={rule.text}
                      onChange={(e) => handleRuleChange(idx, "text", e.target.value.slice(0, 120))}
                      placeholder={dict.journal.strategiesTab.ruleTextPlaceholder}
                      containerClassName="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveRule(idx)}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-short hover:bg-short/10"
                      aria-label={dict.journal.strategiesTab.deleteRule}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:pl-10">
                    <Select<RuleGroup>
                      aria-label={dict.journal.strategiesTab.groupEntry}
                      value={rule.group}
                      onChange={(v) => handleRuleChange(idx, "group", v)}
                      options={[
                        { value: "entry", label: dict.journal.strategiesTab.groupEntry },
                        { value: "exit", label: dict.journal.strategiesTab.groupExit },
                        { value: "risk", label: dict.journal.strategiesTab.groupRisk },
                        { value: "management", label: dict.journal.strategiesTab.groupManagement },
                      ]}
                    />
                    <Select<RuleWeight>
                      aria-label={dict.journal.strategiesTab.weightRequired}
                      value={rule.weight}
                      onChange={(v) => handleRuleChange(idx, "weight", v)}
                      options={[
                        { value: "required", label: dict.journal.strategiesTab.weightRequired },
                        { value: "optional", label: dict.journal.strategiesTab.weightOptional },
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </form>
    </Modal>
  );
}
