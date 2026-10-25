"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AlertTriangle, Brain, Camera, Clock, Compass, Gauge, Star as StarIcon, X } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import {
  Account,
  Trade,
  TradeDirection,
  TradeSession,
  AccountCurrency,
  AccountType,
  RuleCheckValue,
  INSTRUMENT_AUTOCOMPLETE,
  EMOTIONS_CATALOG,
  MISTAKES_CATALOG,
  SESSIONS_CATALOG,
} from "@/lib/journal/types";
import { getLocalDateString } from "@/lib/date-utils";
import { calculateProcessScore } from "@/lib/journal/process-score";
import {
  parseNumberInput,
  normalizeInstrument,
  calculateRMultiple,
  determineTradeResult,
  validateTradeInputs,
  TradeValidationErrors,
} from "@/lib/journal/calc";
import { predictPreTradeUsage, getPhaseTrades, calculatePropMetrics } from "@/lib/journal/prop";
import { evaluatePropToastAlert } from "@/lib/journal/prop-toast";
import { AttachmentManager } from "@/components/journal/AttachmentManager";
import { dirtyFormRegistry } from "@/lib/auth/space-channel";
import { AppStorage } from "@/lib/storage";
import { formatString } from "@/lib/i18n";
import {
  Autocomplete,
  Button,
  ChipMultiSelect,
  DateTimePicker,
  Drawer,
  FormSection,
  Input,
  LabelAction,
  NumberInput,
  Segmented,
  Select,
  StarRating,
  Textarea,
  toLocalDateTime,
} from "@/components/ui";
import { defaultAccountId } from "@/lib/journal/preferences";

interface AddTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTrade?: Trade | null;
  /** Pre-filled opening time for a new trade ("YYYY-MM-DDTHH:mm"), e.g. from a calendar day. */
  initialOpenedAt?: string;
}

const DRAFT_KEY = "ayra_trade_draft";
/** Ticker examples (data, not translatable text). */
const INSTRUMENT_PLACEHOLDER = `${INSTRUMENT_AUTOCOMPLETE[0]}, ${INSTRUMENT_AUTOCOMPLETE[5]}...`;
type SectionId = "time" | "risk" | "context" | "psychology" | "screenshots" | "execution";
const SECTION_IDS: SectionId[] = ["time", "risk", "context", "psychology", "screenshots", "execution"];

type Draft = {
  activeTradeId: string;
  accountId: string;
  instrument: string;
  direction: TradeDirection;
  openedAt: string;
  closedAt: string;
  pnlInput: string;
  rInput: string;
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  takeProfit: string;
  size: string;
  fees: string;
  riskAmount: string;
  session: TradeSession | "";
  emotions: string[];
  entryReason: string;
  mistakes: string[];
  executionRating: number;
  notes: string;
  strategyId: string;
  ruleChecks: Record<string, RuleCheckValue>;
  attachmentIds: string[];
};

function readDraft(): Draft | null {
  try {
    const raw = AppStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    AppStorage.removeItem(DRAFT_KEY);
  } catch {}
}

const numOrEmpty = (n: number | undefined | null) => (n != null ? String(n) : "");

/**
 * Add / edit trade: right drawer on desktop, bottom sheet on phones.
 * Quick entry on top, details in accordion sections; draft autosave, Ctrl+Enter saves, Esc closes.
 * Saving logic (validation, R calculation, process score, prop alerts, rewards) is unchanged.
 */
export function AddTradeModal({ isOpen, onClose, initialTrade, initialOpenedAt }: AddTradeModalProps) {
  const { dict, showToast } = useApp();
  const t = dict.journal.addTradeModal;
  const { recordTrade } = useGame();
  const {
    accounts,
    trades,
    strategies,
    lastSelectedAccountId,
    lastSelectedInstrument,
    preferences,
    saveTrade,
    saveAccount,
    getTradingPlan,
  } = useJournal();
  const { gameState } = useGame();

  const todayStr = getLocalDateString(new Date(), gameState.profile?.timezone);
  const todayPlan = getTradingPlan(todayStr);
  const todayTradesCount = trades.filter((tr) => tr.openedAt.startsWith(todayStr)).length;
  const planMaxTrades = todayPlan?.limits?.maxTrades;

  const activeStrategies = strategies.filter((s) => !s.archivedAt);
  const activeAccounts = accounts.filter((a) => !a.archivedAt);

  const recentInstruments = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    [...trades]
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .forEach((tr) => {
        if (!seen.has(tr.instrument) && out.length < 5) {
          seen.add(tr.instrument);
          out.push(tr.instrument);
        }
      });
    return out;
  }, [trades]);

  // Quick Account inline creation state
  const [showQuickAccount, setShowQuickAccount] = useState(false);
  const [quickAccName, setQuickAccName] = useState("");
  const [quickAccType, setQuickAccType] = useState<AccountType>("personal");
  const [quickAccCurrency, setQuickAccCurrency] = useState<AccountCurrency>("USD");

  // Trade Form state
  const [accountId, setAccountId] = useState<string>("");
  const [instrument, setInstrument] = useState<string>("");
  const [direction, setDirection] = useState<TradeDirection>("long");
  const [openedAt, setOpenedAt] = useState<string>("");
  const [closedAt, setClosedAt] = useState<string>("");
  const [pnlInput, setPnlInput] = useState<string>("");
  const [rInput, setRInput] = useState<string>("");
  const [entryPrice, setEntryPrice] = useState<string>("");
  const [exitPrice, setExitPrice] = useState<string>("");
  const [stopLoss, setStopLoss] = useState<string>("");
  const [takeProfit, setTakeProfit] = useState<string>("");
  const [size, setSize] = useState<string>("");
  const [fees, setFees] = useState<string>("");
  const [riskAmount, setRiskAmount] = useState<string>("");
  const [session, setSession] = useState<TradeSession | "">("");
  const [emotions, setEmotions] = useState<string[]>([]);
  const [entryReason, setEntryReason] = useState<string>("");
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [executionRating, setExecutionRating] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [strategyId, setStrategyId] = useState<string>("");
  const [ruleChecks, setRuleChecks] = useState<Record<string, RuleCheckValue>>({});
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [activeTradeId, setActiveTradeId] = useState<string>("");

  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    time: false,
    risk: false,
    context: false,
    psychology: false,
    screenshots: false,
    execution: false,
  });
  const [draftRestored, setDraftRestored] = useState(false);
  const draftReady = useRef(false);

  const [errors, setErrors] = useState<TradeValidationErrors>({});
  const [isDuplicateWarning, setIsDuplicateWarning] = useState(false);

  const getCurrentLocalIso = () => toLocalDateTime(new Date());

  const applyDraft = (d: Draft) => {
    setActiveTradeId(d.activeTradeId);
    setAccountId(d.accountId);
    setInstrument(d.instrument);
    setDirection(d.direction);
    setOpenedAt(d.openedAt);
    setClosedAt(d.closedAt);
    setPnlInput(d.pnlInput);
    setRInput(d.rInput);
    setEntryPrice(d.entryPrice);
    setExitPrice(d.exitPrice);
    setStopLoss(d.stopLoss);
    setTakeProfit(d.takeProfit);
    setSize(d.size);
    setFees(d.fees);
    setRiskAmount(d.riskAmount);
    setSession(d.session);
    setEmotions(d.emotions ?? []);
    setEntryReason(d.entryReason);
    setMistakes(d.mistakes ?? []);
    setExecutionRating(d.executionRating ?? 0);
    setNotes(d.notes);
    setStrategyId(d.strategyId);
    setRuleChecks(d.ruleChecks ?? {});
    setAttachmentIds(d.attachmentIds ?? []);
  };

  const resetFields = () => {
    setPnlInput("");
    setRInput("");
    setEntryPrice("");
    setExitPrice("");
    setStopLoss("");
    setTakeProfit("");
    setSize("");
    setFees("");
    setRiskAmount("");
    setSession("");
    setEmotions([]);
    setEntryReason("");
    setMistakes([]);
    setExecutionRating(0);
    setNotes("");
    setClosedAt("");
  };

  useEffect(() => {
    if (!isOpen) {
      draftReady.current = false;
      return;
    }
    setDraftRestored(false);

    if (initialTrade) {
      setAccountId(initialTrade.accountId);
      setInstrument(initialTrade.instrument);
      setDirection(initialTrade.direction);
      // Local time, the same format the picker edits (the old code used UTC here and shifted the time on every edit).
      setOpenedAt(initialTrade.openedAt ? toLocalDateTime(new Date(initialTrade.openedAt)) : getCurrentLocalIso());
      setClosedAt(initialTrade.closedAt ? toLocalDateTime(new Date(initialTrade.closedAt)) : "");
      setPnlInput(numOrEmpty(initialTrade.pnlMoney));
      setRInput(numOrEmpty(initialTrade.rMultiple));
      setEntryPrice(numOrEmpty(initialTrade.entryPrice));
      setExitPrice(numOrEmpty(initialTrade.exitPrice));
      setStopLoss(numOrEmpty(initialTrade.stopLoss));
      setTakeProfit(numOrEmpty(initialTrade.takeProfit));
      setSize(numOrEmpty(initialTrade.size));
      setFees(numOrEmpty(initialTrade.fees));
      setRiskAmount(numOrEmpty(initialTrade.riskAmount));
      setSession(initialTrade.session || "");
      setEmotions(initialTrade.emotions || []);
      setEntryReason(initialTrade.entryReason || "");
      setMistakes(initialTrade.mistakes || []);
      setExecutionRating(initialTrade.executionRating || 0);
      setNotes(initialTrade.notes || "");
      setStrategyId(initialTrade.strategyId || "");
      setRuleChecks(initialTrade.ruleChecks || {});
      setAttachmentIds(initialTrade.attachmentIds || []);
      setActiveTradeId(initialTrade.id);
      setOpenSections({
        time: Boolean(initialTrade.closedAt || initialTrade.entryPrice != null || initialTrade.exitPrice != null),
        risk: Boolean(initialTrade.riskAmount != null || initialTrade.size != null || initialTrade.fees != null),
        context: Boolean(initialTrade.session || initialTrade.strategyId),
        psychology: Boolean(initialTrade.emotions?.length || initialTrade.mistakes?.length || initialTrade.entryReason),
        screenshots: Boolean(initialTrade.attachmentIds?.length),
        execution: Boolean(initialTrade.executionRating || initialTrade.notes),
      });
    } else {
      const draft = !initialOpenedAt ? readDraft() : null;
      if (draft) {
        applyDraft(draft);
        setDraftRestored(true);
      } else {
        setActiveTradeId(`tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
        // «Settings → Journal»: the main account if set and active, else the last used, else the first
        const defaultAcc = defaultAccountId(preferences, lastSelectedAccountId, activeAccounts);
        setAccountId(defaultAcc);
        setInstrument(lastSelectedInstrument || "");
        setDirection("long");
        setOpenedAt(initialOpenedAt || getCurrentLocalIso());
        resetFields();
        setSession(preferences.defaultSession ?? "");
        setStrategyId("");
        setRuleChecks({});
        setAttachmentIds([]);
      }
      setOpenSections({ time: false, risk: false, context: false, psychology: false, screenshots: false, execution: false });
    }

    setShowQuickAccount(activeAccounts.length === 0);
    setErrors({});
    setIsDuplicateWarning(false);
    draftReady.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTrade]);

  const isDirty = Boolean(
    instrument.trim() ||
      pnlInput.trim() ||
      rInput.trim() ||
      notes.trim() ||
      entryReason.trim() ||
      emotions.length ||
      mistakes.length ||
      executionRating ||
      attachmentIds.length
  );

  // Draft autosave for new trades
  useEffect(() => {
    if (!isOpen || initialTrade || !draftReady.current) return;
    const timer = setTimeout(() => {
      if (!isDirty) {
        clearDraft();
        return;
      }
      const draft: Draft = {
        activeTradeId,
        accountId,
        instrument,
        direction,
        openedAt,
        closedAt,
        pnlInput,
        rInput,
        entryPrice,
        exitPrice,
        stopLoss,
        takeProfit,
        size,
        fees,
        riskAmount,
        session,
        emotions,
        entryReason,
        mistakes,
        executionRating,
        notes,
        strategyId,
        ruleChecks,
        attachmentIds,
      };
      try {
        AppStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [
    isOpen,
    initialTrade,
    isDirty,
    activeTradeId,
    accountId,
    instrument,
    direction,
    openedAt,
    closedAt,
    pnlInput,
    rInput,
    entryPrice,
    exitPrice,
    stopLoss,
    takeProfit,
    size,
    fees,
    riskAmount,
    session,
    emotions,
    entryReason,
    mistakes,
    executionRating,
    notes,
    strategyId,
    ruleChecks,
    attachmentIds,
  ]);

  useEffect(() => {
    if (!isOpen) {
      dirtyFormRegistry.unregisterForm("add_trade_modal");
      return;
    }
    dirtyFormRegistry.updateForm(
      "add_trade_modal",
      Boolean(instrument.trim() || pnlInput.trim() || rInput.trim() || notes.trim() || entryReason.trim()),
      async () => {
        handleSave(false);
        return { success: true };
      },
      () => `${instrument} ${pnlInput} ${rInput} ${notes}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, instrument, pnlInput, rInput, notes, entryReason]);

  // Check duplicate warning whenever key fields change
  useEffect(() => {
    if (!isOpen || !accountId || !instrument || !openedAt) {
      setIsDuplicateWarning(false);
      return;
    }
    const normalizedInst = normalizeInstrument(instrument);
    const openedMs = new Date(openedAt).getTime();
    if (isNaN(openedMs)) {
      setIsDuplicateWarning(false);
      return;
    }
    const hasDuplicate = trades.some((tr) => {
      if (initialTrade && tr.id === initialTrade.id) return false;
      if (tr.accountId !== accountId || tr.instrument !== normalizedInst || tr.direction !== direction) return false;
      const tOpenedMs = new Date(tr.openedAt).getTime();
      return !isNaN(tOpenedMs) && Math.abs(tOpenedMs - openedMs) <= 60000;
    });
    setIsDuplicateWarning(hasDuplicate);
  }, [isOpen, accountId, instrument, direction, openedAt, trades, initialTrade]);

  const handleCreateQuickAccount = (e?: React.FormEvent) => {
    e?.preventDefault();
    const newAcc: Account = {
      id: `acc_${Date.now()}`,
      name: quickAccName.trim() || null,
      type: quickAccType,
      currency: quickAccCurrency,
      platform: "manual",
      createdAt: new Date().toISOString(),
    };
    saveAccount(newAcc);
    setAccountId(newAcc.id);
    setShowQuickAccount(false);
    showToast(dict.journal.accountsTab.accountSavedToast);
  };

  const handleSave = (addAnother = false) => {
    const validation = validateTradeInputs({
      accountId,
      instrument,
      openedAt,
      closedAt: closedAt || undefined,
    });

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      if (validation.closedAt) setOpenSections((s) => ({ ...s, time: true }));
      return;
    }

    const normInst = normalizeInstrument(instrument);
    const parsedPnl = parseNumberInput(pnlInput);
    const parsedRisk = parseNumberInput(riskAmount);
    const parsedEntry = parseNumberInput(entryPrice);
    const parsedExit = parseNumberInput(exitPrice);
    const parsedSL = parseNumberInput(stopLoss);
    const parsedTP = parseNumberInput(takeProfit);
    const parsedSize = parseNumberInput(size);
    const parsedFees = parseNumberInput(fees);
    let parsedR = parseNumberInput(rInput);

    if (parsedR == null) {
      parsedR = calculateRMultiple({
        direction,
        pnlMoney: parsedPnl,
        riskAmount: parsedRisk,
        entryPrice: parsedEntry,
        exitPrice: parsedExit,
        stopLoss: parsedSL,
      });
    }

    const calculatedResult = determineTradeResult({ pnlMoney: parsedPnl, rMultiple: parsedR });

    const nowIso = new Date().toISOString();
    const isClosed = Boolean(closedAt || parsedPnl !== null || parsedR !== null || parsedExit !== null);
    const resolvedClosedAt = closedAt
      ? new Date(closedAt).toISOString()
      : isClosed
      ? new Date(openedAt).toISOString()
      : undefined;

    const selectedStrategy = strategies.find((s) => s.id === strategyId) || null;
    const selectedAccount = accounts.find((a) => a.id === accountId) || null;

    const tempTrade: Trade = {
      id: activeTradeId || initialTrade?.id || `tr_${Date.now()}`,
      accountId,
      instrument: normInst,
      direction,
      status: isClosed ? "closed" : "open",
      openedAt: new Date(openedAt).toISOString(),
      closedAt: resolvedClosedAt,
      entryPrice: parsedEntry ?? undefined,
      exitPrice: parsedExit ?? undefined,
      stopLoss: parsedSL ?? undefined,
      takeProfit: parsedTP ?? undefined,
      size: parsedSize ?? undefined,
      fees: parsedFees ?? undefined,
      riskAmount: parsedRisk ?? undefined,
      pnlMoney: parsedPnl ?? undefined,
      rMultiple: parsedR ?? undefined,
      result: calculatedResult,
      strategyId: selectedStrategy ? selectedStrategy.id : null,
      strategyVersion: selectedStrategy ? selectedStrategy.version : null,
      ruleChecks,
      session: session || undefined,
      emotions,
      entryReason: entryReason.slice(0, 500) || undefined,
      mistakes,
      executionRating: executionRating || undefined,
      notes: notes.slice(0, 1000) || undefined,
      verification: "unverified",
      source: "manual",
      attachmentIds,
      createdAt: initialTrade?.createdAt || nowIso,
      updatedAt: nowIso,
      schemaVersion: 3,
    };

    const psRes = calculateProcessScore(tempTrade, selectedStrategy, selectedAccount, nowIso);
    const tradeToSave: Trade = { ...tempTrade, processScore: psRes.score, processScoreSnapshot: psRes.snapshot };

    const prevMetrics = selectedAccount?.propRules ? calculatePropMetrics(selectedAccount, trades) : undefined;

    saveTrade(tradeToSave);
    if (!initialTrade) clearDraft();

    let propToastText = "";
    if (selectedAccount && selectedAccount.propRules) {
      const updatedTradesList = [...trades.filter((tr) => tr.id !== tradeToSave.id), tradeToSave];
      const currMetrics = calculatePropMetrics(selectedAccount, updatedTradesList);
      const { alert } = evaluatePropToastAlert(selectedAccount, prevMetrics, currMetrics);
      if (alert) {
        const roundedPct = Math.round(alert.usedPct);
        const toasts = dict.journal.propRules.toasts;
        if (alert.limitType === "dailyLoss") {
          if (alert.level === "caution") propToastText = toasts.dailyLossCaution.replace("{pct}", String(roundedPct));
          else if (alert.level === "close") propToastText = toasts.dailyLossClose.replace("{pct}", String(roundedPct));
          else if (alert.level === "reached") propToastText = toasts.dailyLossReached;
        } else if (alert.limitType === "totalDrawdown") {
          if (alert.level === "caution") propToastText = toasts.totalDrawdownCaution.replace("{pct}", String(roundedPct));
          else if (alert.level === "close") propToastText = toasts.totalDrawdownClose.replace("{pct}", String(roundedPct));
          else if (alert.level === "reached") propToastText = toasts.totalDrawdownReached;
        }
      }
    }

    const rewardRes = recordTrade(tradeToSave, trades);

    if (propToastText) {
      showToast(propToastText);
    } else if (rewardRes.xpAwarded > 0) {
      showToast(`+${rewardRes.xpAwarded} XP (${dict.stats.trading})`);
    } else if (rewardRes.leveledUp) {
      showToast(`Level up! Lv ${rewardRes.newLevel}`);
    } else {
      showToast(initialTrade ? t.tradeUpdatedToast : t.tradeSavedToast);
    }

    if (addAnother) {
      // Keep account & instrument, new id for the next trade
      resetFields();
      setOpenedAt(getCurrentLocalIso());
      setAttachmentIds([]);
      setRuleChecks({});
      setActiveTradeId(`tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
      setErrors({});
    } else {
      onClose();
    }
  };

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSaveRef.current(false);
    }
  }, []);

  if (!isOpen) return null;

  const toggleSection = (id: SectionId) => setOpenSections((s) => ({ ...s, [id]: !s[id] }));
  const allOpen = SECTION_IDS.every((id) => openSections[id]);
  const filled = (n: number) => (n > 0 ? formatString(t.filledCount, { count: n }) : undefined);
  const countFilled = (...values: unknown[]) =>
    values.filter((v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : Boolean(v))).length;

  const accountOptions = activeAccounts.map((a) => ({
    value: a.id,
    label: `${a.name || dict.journal.accountsTab.mainAccountDefaultName} (${a.currency})`,
    description: a.type === "prop" ? dict.journal.accountsTab.typeProp : a.type === "demo" ? dict.journal.accountsTab.typeDemo : undefined,
  }));
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const currencyUnit = selectedAccount?.currency === "USD" || !selectedAccount ? "$" : selectedAccount.currency;
  const selectedStrategy = activeStrategies.find((s) => s.id === strategyId);

  const preTrade = (() => {
    if (!selectedAccount || !selectedAccount.propRules || !selectedAccount.propRules.startedAt) return null;
    const riskVal = parseNumberInput(riskAmount);
    if (!riskVal || riskVal <= 0) return null;
    const phaseTrades = getPhaseTrades(trades, selectedAccount.propRules, selectedAccount.id);
    return predictPreTradeUsage(selectedAccount, phaseTrades, riskVal, initialTrade?.id, openedAt ? new Date(openedAt) : new Date());
  })();

  const footer = showQuickAccount || activeAccounts.length === 0 ? undefined : (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={() => handleSave(false)}>
          {t.saveBtn}
        </Button>
        {!initialTrade && (
          <Button variant="secondary" onClick={() => handleSave(true)}>
            {t.saveAndAddAnotherBtn}
          </Button>
        )}
      </div>
      <p className="hidden text-center text-xs text-mu md:block">{t.shortcutHint}</p>
    </div>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={initialTrade ? t.editTitle : t.title}
      subtitle={t.subtitle}
      closeLabel={t.closeLabel}
      footer={footer}
      data-testid="add-trade-drawer"
    >
      <div className="space-y-5" onKeyDown={onKeyDown}>
        {draftRestored && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-vi/40 bg-vi/10 px-3 py-2 text-sm text-tx" role="status">
            <span>{t.draftRestored}</span>
            <button
              type="button"
              onClick={() => {
                clearDraft();
                setDraftRestored(false);
                resetFields();
                setInstrument("");
                setOpenedAt(getCurrentLocalIso());
                setAttachmentIds([]);
                setRuleChecks({});
                setStrategyId("");
                setActiveTradeId(`tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
              }}
              className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 text-xs font-semibold text-vi hover:bg-vi/10"
            >
              <X size={14} aria-hidden="true" />
              {t.draftDiscard}
            </button>
          </div>
        )}

        {planMaxTrades != null && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-s2/60 px-3 py-2 text-xs">
            <span className="font-medium text-mu">
              {dict.journal.planLimitInfo.replace("{max}", String(planMaxTrades)).replace("{current}", String(todayTradesCount))}
            </span>
            {todayTradesCount >= planMaxTrades && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300">
                {dict.journal.planLimitReached}
              </span>
            )}
          </div>
        )}

        {isDuplicateWarning && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">
            <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
            <span>{t.duplicateWarning}</span>
          </div>
        )}

        {showQuickAccount || activeAccounts.length === 0 ? (
          <form onSubmit={handleCreateQuickAccount} className="space-y-4 rounded-lg border border-line bg-ink/40 p-4">
            <div>
              <h3 className="text-sm font-semibold text-tx">{t.quickAccountTitle}</h3>
              <p className="mt-0.5 text-xs text-mu">{t.noAccountsPrompt}</p>
            </div>
            <Input
              label={dict.journal.accountsTab.title}
              value={quickAccName}
              onChange={(e) => setQuickAccName(e.target.value)}
              placeholder={t.accountNamePlaceholder}
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={dict.journal.accountTypeLabel}
                value={quickAccType}
                onChange={setQuickAccType}
                options={[
                  { value: "personal" as AccountType, label: dict.journal.accountsTab.typePersonal },
                  { value: "prop" as AccountType, label: dict.journal.accountsTab.typeProp },
                  { value: "demo" as AccountType, label: dict.journal.accountsTab.typeDemo },
                ]}
              />
              <Select
                label={dict.journal.currencyLabel}
                value={quickAccCurrency}
                onChange={setQuickAccCurrency}
                options={(["USD", "EUR", "GBP", "GEL", "RUB", "UAH", "KZT", "USDT"] as AccountCurrency[]).map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                {t.createAccountBtn}
              </Button>
              {activeAccounts.length > 0 && (
                <Button variant="ghost" onClick={() => setShowQuickAccount(false)}>
                  {dict.deviceData.cancelBtn}
                </Button>
              )}
            </div>
          </form>
        ) : (
          <>
            {/* Quick entry */}
            <section className="space-y-4" aria-label={t.quickTitle}>
              <Autocomplete
                label={t.instrumentLabel}
                value={instrument}
                onChange={(v) => setInstrument(v.toUpperCase())}
                recent={recentInstruments}
                suggestions={INSTRUMENT_AUTOCOMPLETE}
                placeholder={INSTRUMENT_PLACEHOLDER}
                inputClassName="uppercase font-semibold tracking-wide"
                error={errors.instrument ? dict.journal.errorRequired : undefined}
                data-testid="instrument-input"
              />
              <Segmented
                label={t.directionLabel}
                value={direction}
                onChange={setDirection}
                size="lg"
                options={[
                  { value: "long", label: t.directionLong, tone: "long" },
                  { value: "short", label: t.directionShort, tone: "short" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label={dict.journal.resultMoneyLabel}
                  unit={currencyUnit}
                  signed
                  value={pnlInput}
                  onChange={(e) => setPnlInput(e.target.value)}
                  placeholder="150 / -50"
                />
                <NumberInput
                  label={dict.journal.resultRLabel}
                  unit="R"
                  signed
                  value={rInput}
                  onChange={(e) => setRInput(e.target.value)}
                  placeholder="2.5 / -1"
                />
              </div>
              <p className="-mt-2 text-xs text-mu">{t.resultHint}</p>
              <Select
                label={t.accountLabel}
                value={accountId}
                onChange={setAccountId}
                options={accountOptions}
                data-testid="account-select"
                error={errors.accountId ? dict.journal.errorRequired : undefined}
                labelAction={<LabelAction onClick={() => setShowQuickAccount(true)}>{dict.journal.newAccountBtn}</LabelAction>}
              />
            </section>

            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-mu">{t.modeDetailed}</span>
              <button
                type="button"
                onClick={() => {
                  const next = !allOpen;
                  setOpenSections({ time: next, risk: next, context: next, psychology: next, screenshots: next, execution: next });
                }}
                className="min-h-[36px] rounded px-2 text-xs font-semibold text-vi hover:bg-vi/10"
              >
                {allOpen ? t.collapseAll : t.expandAll}
              </button>
            </div>

            <div className="space-y-3">
              <FormSection
                title={t.sectionTimePrices}
                icon={<Clock size={18} />}
                open={openSections.time}
                onToggle={() => toggleSection("time")}
                summary={filled(countFilled(closedAt, entryPrice, exitPrice, stopLoss, takeProfit))}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <DateTimePicker
                    label={t.openedAtLabel}
                    value={openedAt}
                    onChange={setOpenedAt}
                    data-testid="opened-at"
                    error={
                      errors.openedAt === "futureDate"
                        ? dict.journal.errorFutureDate
                        : errors.openedAt === "invalidDate"
                        ? dict.journal.errorInvalidDate
                        : undefined
                    }
                  />
                  <DateTimePicker
                    label={t.closedAtLabel}
                    value={closedAt}
                    onChange={setClosedAt}
                    clearable
                    optional
                    error={errors.closedAt === "closedBeforeOpened" ? dict.journal.errorClosedBeforeOpened : undefined}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label={t.entryPriceLabel} value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
                  <NumberInput label={t.exitPriceLabel} value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} />
                  <NumberInput label={t.stopLossLabel} value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
                  <NumberInput label={t.takeProfitLabel} value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
                </div>
              </FormSection>

              <FormSection
                title={t.sectionRisk}
                icon={<Gauge size={18} />}
                open={openSections.risk}
                onToggle={() => toggleSection("risk")}
                summary={filled(countFilled(riskAmount, size, fees))}
              >
                <NumberInput label={t.riskAmountLabel} unit={currencyUnit} value={riskAmount} onChange={(e) => setRiskAmount(e.target.value)} placeholder="100" />
                {preTrade && (
                  <div
                    className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
                      preTrade.worstStatus !== "ok" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-line bg-s2/60 text-mu"
                    }`}
                  >
                    <span>
                      {dict.journal.propRules.preTrade.warning
                        .replace(
                          "{metric}",
                          preTrade.dailyLossPct >= preTrade.totalDrawdownPct
                            ? dict.journal.propRules.metrics.dailyLoss
                            : dict.journal.propRules.metrics.totalDrawdown
                        )
                        .replace("{percent}", preTrade.maxUsedPct.toFixed(0))}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                        preTrade.worstStatus === "reached"
                          ? "bg-purple-500/20 text-purple-300"
                          : preTrade.worstStatus === "close"
                          ? "bg-rose-500/20 text-rose-300"
                          : preTrade.worstStatus === "caution"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {dict.journal.propRules.status[preTrade.worstStatus]}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label={t.sizeLabel} value={size} onChange={(e) => setSize(e.target.value)} placeholder="1.0" />
                  <NumberInput label={t.feesLabel} unit={currencyUnit} value={fees} onChange={(e) => setFees(e.target.value)} placeholder="5.0" />
                </div>
              </FormSection>

              <FormSection
                title={t.sectionContext}
                icon={<Compass size={18} />}
                open={openSections.context}
                onToggle={() => toggleSection("context")}
                summary={filled(countFilled(session, strategyId, Object.keys(ruleChecks)))}
              >
                <Select
                  label={t.sessionLabel}
                  value={session}
                  onChange={(v) => setSession(v === "none" ? "" : (v as TradeSession))}
                  placeholder="—"
                  options={[
                    { value: "none", label: "—" },
                    ...SESSIONS_CATALOG.map((s) => ({ value: s as string, label: dict.journal.sessions[s] })),
                  ]}
                />
                {activeStrategies.length === 0 ? (
                  <p className="rounded-md border border-line bg-s2/40 p-3 text-xs text-mu">{t.noActiveStrategiesHint}</p>
                ) : (
                  <Select
                    label={t.strategyLabel}
                    value={strategyId || "none"}
                    onChange={(v) => {
                      setStrategyId(v === "none" ? "" : v);
                      setRuleChecks({});
                    }}
                    options={[
                      { value: "none", label: t.noStrategySelected },
                      ...activeStrategies.map((s) => ({
                        value: s.id,
                        label: s.name || dict.journal.strategiesTab.defaultName,
                        description: `${s.rules.length} ${dict.journal.strategiesTab.rulesCountLabel}`,
                      })),
                    ]}
                  />
                )}
                {selectedStrategy && selectedStrategy.rules.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-tx">{t.ruleChecklistTitle}</div>
                    <ul className="space-y-2">
                      {selectedStrategy.rules.map((rule) => (
                        <li key={rule.id} className="space-y-2 rounded-md border border-line bg-s1 p-3">
                          <div className="flex items-start gap-2 text-sm text-tx">
                            <span className="mt-0.5 shrink-0 rounded border border-line bg-s2 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-mu">
                              {rule.group}
                            </span>
                            <span className="min-w-0 flex-1">{rule.text}</span>
                            {rule.weight === "required" && <span className="shrink-0 font-bold text-amber-300">*</span>}
                          </div>
                          <Segmented
                            name={rule.text}
                            value={ruleChecks[rule.id] ?? null}
                            onChange={(v) => setRuleChecks((prev) => ({ ...prev, [rule.id]: v }))}
                            options={[
                              { value: "passed" as RuleCheckValue, label: t.rulePassed, tone: "long" },
                              { value: "failed" as RuleCheckValue, label: t.ruleFailed, tone: "short" },
                              { value: "na" as RuleCheckValue, label: t.ruleNA, tone: "neutral" },
                            ]}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </FormSection>

              <FormSection
                title={t.sectionPsychology}
                icon={<Brain size={18} />}
                open={openSections.psychology}
                onToggle={() => toggleSection("psychology")}
                summary={filled(countFilled(emotions, mistakes, entryReason))}
              >
                <ChipMultiSelect
                  label={dict.journal.emotionsHeader}
                  value={emotions}
                  onChange={setEmotions}
                  options={EMOTIONS_CATALOG.map((e) => ({ value: e, label: dict.journal.emotions[e] }))}
                />
                <ChipMultiSelect
                  label={t.mistakesLabel}
                  value={mistakes}
                  onChange={setMistakes}
                  tone="danger"
                  options={MISTAKES_CATALOG.map((m) => ({ value: m, label: dict.journal.mistakes[m] }))}
                />
                <Textarea
                  label={t.entryReasonLabel}
                  value={entryReason}
                  onChange={(e) => setEntryReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder={dict.journal.entryReasonPlaceholder}
                />
              </FormSection>

              <FormSection
                title={t.sectionScreenshots}
                icon={<Camera size={18} />}
                open={openSections.screenshots}
                onToggle={() => toggleSection("screenshots")}
                summary={filled(attachmentIds.length)}
              >
                <AttachmentManager tradeId={activeTradeId} tradeOpenedAt={openedAt} expectedIds={initialTrade?.attachmentIds} onAttachmentsChanged={(ids) => setAttachmentIds(ids)} />
              </FormSection>

              <FormSection
                title={t.sectionExecution}
                icon={<StarIcon size={18} />}
                open={openSections.execution}
                onToggle={() => toggleSection("execution")}
                summary={filled(countFilled(executionRating, notes))}
              >
                <StarRating label={t.executionRatingLabel} value={executionRating} onChange={setExecutionRating} />
                <Textarea
                  label={t.notesLabel}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={dict.journal.notesPlaceholder}
                />
              </FormSection>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
