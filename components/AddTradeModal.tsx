"use client";

import React, { useState, useEffect, useRef } from "react";
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
  INSTRUMENT_AUTOCOMPLETE,
  EMOTIONS_CATALOG,
  MISTAKES_CATALOG,
  SESSIONS_CATALOG,
} from "@/lib/journal/types";
import {
  parseNumberInput,
  normalizeInstrument,
  calculateRMultiple,
  determineTradeResult,
  validateTradeInputs,
  TradeValidationErrors,
} from "@/lib/journal/calc";
import { recordLoggedTrade } from "@/lib/game";

interface AddTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTrade?: Trade | null;
}

export function AddTradeModal({ isOpen, onClose, initialTrade }: AddTradeModalProps) {
  const { dict, showToast } = useApp();
  const { recordTrade } = useGame();
  const {
    accounts,
    trades,
    lastSelectedAccountId,
    lastSelectedInstrument,
    saveTrade,
    saveAccount,
  } = useJournal();

  const activeAccounts = accounts.filter((a) => !a.archivedAt);

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

  // Quick result input (money or R)
  const [pnlInput, setPnlInput] = useState<string>("");
  const [rInput, setRInput] = useState<string>("");

  // Detailed mode toggle
  const [isDetailed, setIsDetailed] = useState(false);

  // Detailed fields
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
  const [executionRating, setExecutionRating] = useState<number | 0>(0);
  const [notes, setNotes] = useState<string>("");

  // Validation & Duplicate Warning
  const [errors, setErrors] = useState<TradeValidationErrors>({});
  const [isDuplicateWarning, setIsDuplicateWarning] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  const getCurrentLocalIso = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (!isOpen) return;

    if (initialTrade) {
      setAccountId(initialTrade.accountId);
      setInstrument(initialTrade.instrument);
      setDirection(initialTrade.direction);
      setOpenedAt(
        initialTrade.openedAt
          ? new Date(initialTrade.openedAt).toISOString().slice(0, 16)
          : getCurrentLocalIso()
      );
      setClosedAt(
        initialTrade.closedAt
          ? new Date(initialTrade.closedAt).toISOString().slice(0, 16)
          : ""
      );
      setPnlInput(initialTrade.pnlMoney != null ? String(initialTrade.pnlMoney) : "");
      setRInput(initialTrade.rMultiple != null ? String(initialTrade.rMultiple) : "");
      setEntryPrice(initialTrade.entryPrice != null ? String(initialTrade.entryPrice) : "");
      setExitPrice(initialTrade.exitPrice != null ? String(initialTrade.exitPrice) : "");
      setStopLoss(initialTrade.stopLoss != null ? String(initialTrade.stopLoss) : "");
      setTakeProfit(initialTrade.takeProfit != null ? String(initialTrade.takeProfit) : "");
      setSize(initialTrade.size != null ? String(initialTrade.size) : "");
      setFees(initialTrade.fees != null ? String(initialTrade.fees) : "");
      setRiskAmount(initialTrade.riskAmount != null ? String(initialTrade.riskAmount) : "");
      setSession(initialTrade.session || "");
      setEmotions(initialTrade.emotions || []);
      setEntryReason(initialTrade.entryReason || "");
      setMistakes(initialTrade.mistakes || []);
      setExecutionRating(initialTrade.executionRating || 0);
      setNotes(initialTrade.notes || "");
      setIsDetailed(true);
    } else {
      // Default initialization
      const defaultAcc =
        lastSelectedAccountId && activeAccounts.some((a) => a.id === lastSelectedAccountId)
          ? lastSelectedAccountId
          : activeAccounts[0]?.id || "";

      setAccountId(defaultAcc);
      setInstrument(lastSelectedInstrument || "");
      setDirection("long");
      setOpenedAt(getCurrentLocalIso());
      setClosedAt("");
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
      setIsDetailed(false);
    }

    setShowQuickAccount(activeAccounts.length === 0);
    setErrors({});
    setIsDuplicateWarning(false);
  }, [isOpen, initialTrade]);

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

    const hasDuplicate = trades.some((t) => {
      if (initialTrade && t.id === initialTrade.id) return false;
      if (t.accountId !== accountId || t.instrument !== normalizedInst || t.direction !== direction) {
        return false;
      }
      const tOpenedMs = new Date(t.openedAt).getTime();
      return !isNaN(tOpenedMs) && Math.abs(tOpenedMs - openedMs) <= 60000;
    });

    setIsDuplicateWarning(hasDuplicate);
  }, [isOpen, accountId, instrument, direction, openedAt, trades, initialTrade]);

  // Close on Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCreateQuickAccount = (e: React.FormEvent) => {
    e.preventDefault();
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

  const toggleEmotion = (emotionId: string) => {
    setEmotions((prev) =>
      prev.includes(emotionId) ? prev.filter((e) => e !== emotionId) : [...prev, emotionId]
    );
  };

  const toggleMistake = (mistakeId: string) => {
    setMistakes((prev) =>
      prev.includes(mistakeId) ? prev.filter((m) => m !== mistakeId) : [...prev, mistakeId]
    );
  };

  const handleSave = (addAnother = false) => {
    // Validate
    const validation = validateTradeInputs({
      accountId,
      instrument,
      openedAt,
      closedAt: closedAt || undefined,
    });

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
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

    // Calculate R if not explicitly given
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

    const calculatedResult = determineTradeResult({
      pnlMoney: parsedPnl,
      rMultiple: parsedR,
    });

    const nowIso = new Date().toISOString();
    const tradeToSave: Trade = {
      id: initialTrade?.id || `tr_${Date.now()}`,
      accountId,
      instrument: normInst,
      direction,
      status: closedAt ? "closed" : "open",
      openedAt: new Date(openedAt).toISOString(),
      closedAt: closedAt ? new Date(closedAt).toISOString() : undefined,
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
      session: session || undefined,
      emotions,
      entryReason: entryReason.slice(0, 500) || undefined,
      mistakes,
      executionRating: executionRating || undefined,
      notes: notes.slice(0, 1000) || undefined,
      verification: "unverified",
      source: "manual",
      createdAt: initialTrade?.createdAt || nowIso,
      updatedAt: nowIso,
      schemaVersion: 1,
    };

    saveTrade(tradeToSave);

    // Award XP and complete q_tradelog
    const rewardRes = recordTrade(tradeToSave, trades);

    if (rewardRes.xpAwarded > 0) {
      showToast(`+${rewardRes.xpAwarded} XP (${dict.stats.trading})`);
    } else if (rewardRes.leveledUp) {
      showToast(`Level up! Lv ${rewardRes.newLevel}`);
    } else {
      showToast(initialTrade ? dict.journal.addTradeModal.tradeUpdatedToast : dict.journal.addTradeModal.tradeSavedToast);
    }

    if (addAnother) {
      // Reset form but keep account & instrument
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
      setOpenedAt(getCurrentLocalIso());
      setClosedAt("");
      setErrors({});
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4 shadow-xl border border-line"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line/60 pb-3">
          <div>
            <h3 className="h3">{dict.journal.addTradeModal.title}</h3>
            <p className="text-xs text-mu mt-0.5">{dict.journal.addTradeModal.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-mu hover:text-tx transition-colors p-1 text-lg font-bold"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Duplicate Warning */}
        {isDuplicateWarning && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>{dict.journal.addTradeModal.duplicateWarning}</span>
          </div>
        )}

        {/* No Accounts / Quick Account Creation Inline Form */}
        {showQuickAccount || activeAccounts.length === 0 ? (
          <form onSubmit={handleCreateQuickAccount} className="p-4 bg-s2/60 border border-line rounded-xl space-y-3">
            <h4 className="font-semibold text-sm text-tx">{dict.journal.addTradeModal.quickAccountTitle}</h4>
            <p className="text-xs text-mu">{dict.journal.addTradeModal.noAccountsPrompt}</p>

            <div>
              <label className="text-xs text-mu block mb-1">{dict.journal.accountsTab.title}</label>
              <input
                type="text"
                value={quickAccName}
                onChange={(e) => setQuickAccName(e.target.value)}
                placeholder={dict.journal.addTradeModal.accountNamePlaceholder}
                className="input text-xs w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-mu block mb-1">{dict.journal.accountTypeLabel}</label>
                <select
                  value={quickAccType}
                  onChange={(e) => setQuickAccType(e.target.value as AccountType)}
                  className="input text-xs w-full"
                >
                  <option value="personal">{dict.journal.accountsTab.typePersonal}</option>
                  <option value="prop">{dict.journal.accountsTab.typeProp}</option>
                  <option value="demo">{dict.journal.accountsTab.typeDemo}</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-mu block mb-1">{dict.journal.currencyLabel}</label>
                <select
                  value={quickAccCurrency}
                  onChange={(e) => setQuickAccCurrency(e.target.value as AccountCurrency)}
                  className="input text-xs w-full"
                >
                  {["USD", "EUR", "GBP", "GEL", "RUB", "UAH", "KZT", "USDT"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full py-2 text-xs font-semibold">
              {dict.journal.addTradeModal.createAccountBtn}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Quick Section */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Account */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-mu">{dict.journal.addTradeModal.accountLabel}</label>
                    <button
                      type="button"
                      onClick={() => setShowQuickAccount(true)}
                      className="text-[10px] text-acc hover:underline"
                    >
                      {dict.journal.newAccountBtn}
                    </button>
                  </div>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="input text-xs w-full"
                  >
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || dict.journal.accountsTab.mainAccountDefaultName} ({a.currency})
                      </option>
                    ))}
                  </select>
                  {errors.accountId && <p className="text-[10px] text-red-400 mt-0.5">{dict.journal.errorRequired}</p>}
                </div>

                {/* Instrument */}
                <div>
                  <label className="text-xs text-mu block mb-1">{dict.journal.addTradeModal.instrumentLabel}</label>
                  <input
                    type="text"
                    value={instrument}
                    onChange={(e) => setInstrument(e.target.value)}
                    placeholder="XAUUSD, EURUSD..."
                    className="input text-xs w-full uppercase"
                    list="instruments-list"
                  />
                  <datalist id="instruments-list">
                    {INSTRUMENT_AUTOCOMPLETE.map((inst) => (
                      <option key={inst} value={inst} />
                    ))}
                  </datalist>
                  {errors.instrument && <p className="text-[10px] text-red-400 mt-0.5">{dict.journal.errorRequired}</p>}
                </div>
              </div>

              {/* Direction & Opened Time */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-mu block mb-1">{dict.journal.addTradeModal.directionLabel}</label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-s2 rounded-lg border border-line">
                    <button
                      type="button"
                      onClick={() => setDirection("long")}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                        direction === "long" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-mu hover:text-tx"
                      }`}
                    >
                      {dict.journal.addTradeModal.directionLong}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection("short")}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                        direction === "short" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "text-mu hover:text-tx"
                      }`}
                    >
                      {dict.journal.addTradeModal.directionShort}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-mu">{dict.journal.addTradeModal.openedAtLabel}</label>
                    <button
                      type="button"
                      onClick={() => setOpenedAt(getCurrentLocalIso())}
                      className="text-[10px] text-acc hover:underline"
                    >
                      {dict.journal.addTradeModal.nowBtn}
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={openedAt}
                    onChange={(e) => setOpenedAt(e.target.value)}
                    className="input text-xs w-full"
                  />
                  {errors.openedAt === "futureDate" && (
                    <p className="text-[10px] text-amber-400 mt-0.5">{dict.journal.errorFutureDate}</p>
                  )}
                  {errors.openedAt === "invalidDate" && (
                    <p className="text-[10px] text-red-400 mt-0.5">{dict.journal.errorInvalidDate}</p>
                  )}
                </div>
              </div>

              {/* Quick Result / Money & R */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-xs text-mu block mb-1">{dict.journal.resultMoneyLabel}</label>
                  <input
                    type="text"
                    value={pnlInput}
                    onChange={(e) => setPnlInput(e.target.value)}
                    placeholder="150 / -50"
                    className="input text-xs w-full"
                  />
                </div>

                <div>
                  <label className="text-xs text-mu block mb-1">{dict.journal.resultRLabel}</label>
                  <input
                    type="text"
                    value={rInput}
                    onChange={(e) => setRInput(e.target.value)}
                    placeholder="2.5 / -1"
                    className="input text-xs w-full"
                  />
                </div>
              </div>
            </div>

            {/* Detailed Accordion Toggle */}
            <div className="border-t border-line/60 pt-3">
              <button
                type="button"
                onClick={() => setIsDetailed(!isDetailed)}
                className="flex items-center justify-between w-full py-1 text-xs font-semibold text-acc hover:text-tx transition-colors"
              >
                <span>
                  {isDetailed ? "▲ " : "▼ "}
                  {dict.journal.addTradeModal.modeDetailed}
                </span>
                <span className="text-[10px] text-mu font-normal">
                  {dict.journal.modeDetailedSub}
                </span>
              </button>

              {isDetailed && (
                <div className="space-y-3 mt-3 pt-3 border-t border-line/40">
                  {/* Closed time */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-mu">{dict.journal.addTradeModal.closedAtLabel}</label>
                        <button
                          type="button"
                          onClick={() => setClosedAt(getCurrentLocalIso())}
                          className="text-[10px] text-acc hover:underline"
                        >
                          {dict.journal.addTradeModal.nowBtn}
                        </button>
                      </div>
                      <input
                        type="datetime-local"
                        value={closedAt}
                        onChange={(e) => setClosedAt(e.target.value)}
                        className="input text-xs w-full"
                      />
                      {errors.closedAt === "closedBeforeOpened" && (
                        <p className="text-[10px] text-red-400 mt-0.5">{dict.journal.errorClosedBeforeOpened}</p>
                      )}
                    </div>

                    <div>
                      <label className="text-xs text-mu block mb-1">{dict.journal.addTradeModal.riskAmountLabel}</label>
                      <input
                        type="text"
                        value={riskAmount}
                        onChange={(e) => setRiskAmount(e.target.value)}
                        placeholder="100"
                        className="input text-xs w-full"
                      />
                    </div>
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.entryPriceLabel}</label>
                      <input
                        type="text"
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        className="input text-xs w-full"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.exitPriceLabel}</label>
                      <input
                        type="text"
                        value={exitPrice}
                        onChange={(e) => setExitPrice(e.target.value)}
                        className="input text-xs w-full"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.stopLossLabel}</label>
                      <input
                        type="text"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        className="input text-xs w-full"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.takeProfitLabel}</label>
                      <input
                        type="text"
                        value={takeProfit}
                        onChange={(e) => setTakeProfit(e.target.value)}
                        className="input text-xs w-full"
                      />
                    </div>
                  </div>

                  {/* Size, Fees, Session */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.sizeLabel}</label>
                      <input
                        type="text"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        placeholder="1.0"
                        className="input text-xs w-full"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.feesLabel}</label>
                      <input
                        type="text"
                        value={fees}
                        onChange={(e) => setFees(e.target.value)}
                        placeholder="5.0"
                        className="input text-xs w-full"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.sessionLabel}</label>
                      <select
                        value={session}
                        onChange={(e) => setSession(e.target.value as TradeSession)}
                        className="input text-xs w-full"
                      >
                        <option value="">—</option>
                        {SESSIONS_CATALOG.map((s) => (
                          <option key={s} value={s}>
                            {dict.journal.sessions[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Emotions */}
                  <div>
                    <label className="text-[11px] text-mu block mb-1">{dict.journal.emotionsHeader}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {EMOTIONS_CATALOG.map((emo) => {
                        const active = emotions.includes(emo);
                        return (
                          <button
                            key={emo}
                            type="button"
                            onClick={() => toggleEmotion(emo)}
                            className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                              active
                                ? "bg-acc/20 border-acc text-tx font-medium"
                                : "bg-s2 border-line text-mu hover:text-tx"
                            }`}
                          >
                            {dict.journal.emotions[emo]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Entry Reason */}
                  <div>
                    <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.entryReasonLabel}</label>
                    <textarea
                      value={entryReason}
                      onChange={(e) => setEntryReason(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder={dict.journal.entryReasonPlaceholder}
                      className="input text-xs w-full"
                    />
                  </div>

                  {/* Mistakes */}
                  <div>
                    <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.mistakesLabel}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {MISTAKES_CATALOG.map((m) => {
                        const active = mistakes.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleMistake(m)}
                            className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                              active
                                ? "bg-rose-500/20 border-rose-500 text-rose-300 font-medium"
                                : "bg-s2 border-line text-mu hover:text-tx"
                            }`}
                          >
                            {dict.journal.mistakes[m]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Execution Rating */}
                  <div>
                    <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.executionRatingLabel} (1-5)</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setExecutionRating(star)}
                          className={`w-8 h-8 rounded-lg border text-xs font-bold transition-colors ${
                            executionRating >= star
                              ? "bg-amber-500/20 border-amber-500 text-amber-400"
                              : "bg-s2 border-line text-mu hover:text-tx"
                          }`}
                        >
                          {star}★
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[11px] text-mu block mb-1">{dict.journal.addTradeModal.notesLabel}</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder={dict.journal.notesPlaceholder}
                      className="input text-xs w-full"
                    />
                  </div>

                  {/* Screenshots Stub */}
                  <div className="p-2.5 bg-s2/40 border border-line border-dashed rounded-lg text-xs text-mu flex justify-between items-center">
                    <span>{dict.journal.addTradeModal.screenshotsSoon}</span>
                    <span className="badge-free text-[10px]">T6c</span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-line/60">
              <button
                type="button"
                onClick={() => handleSave(false)}
                className="btn-primary flex-1 py-2 text-xs font-semibold"
              >
                {dict.journal.addTradeModal.saveBtn}
              </button>
              {!initialTrade && (
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  className="btn-secondary py-2 text-xs font-medium"
                >
                  {dict.journal.addTradeModal.saveAndAddAnotherBtn}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
