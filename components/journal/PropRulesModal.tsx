"use client";

import React, { useState } from "react";
import {
  Account,
  PropRules,
  PropPhaseArchive,
  PropUserOutcome,
  PropDailyLossBase,
  PropDrawdownMode,
  PropValueType,
} from "@/lib/journal/types";
import { calculatePropMetrics } from "@/lib/journal/prop";
import { Trade } from "@/lib/journal/types";
import { HelpCircle, Copy, ArrowRight, Check, History } from "lucide-react";

interface PropRulesModalProps {
  isOpen: boolean;
  account: Account;
  accounts: Account[];
  trades: Trade[];
  onClose: () => void;
  onSave: (updatedAccount: Account) => void;
  dict: any;
}

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Tokyo",
];

export const PropRulesModal: React.FC<PropRulesModalProps> = ({
  isOpen,
  account,
  accounts,
  trades,
  onClose,
  onSave,
  dict,
}) => {
  const currentRules: Partial<PropRules> = account.propRules || {};
  const userTimezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC";

  // Wizard Step: 1 | 2 | 3 | "changePhase"
  const [step, setStep] = useState<1 | 2 | 3 | "changePhase">(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [phaseLabel, setPhaseLabel] = useState(currentRules.phaseLabel || "Phase 1");
  const [initialBalance, setInitialBalance] = useState<string>(
    currentRules.initialBalance != null
      ? String(currentRules.initialBalance)
      : String(account.startBalance || 100000)
  );
  const [startedAt, setStartedAt] = useState<string>(
    currentRules.startedAt
      ? currentRules.startedAt.split("T")[0]
      : new Date().toISOString().split("T")[0]
  );

  // Day Reset
  const [tz, setTz] = useState<string>(currentRules.dayReset?.timezone || userTimezone);
  const [resetHour, setResetHour] = useState<number>(currentRules.dayReset?.hour ?? 17);

  // Limits
  const [dailyLossVal, setDailyLossVal] = useState<string>(
    currentRules.maxDailyLoss?.value != null ? String(currentRules.maxDailyLoss.value) : "5"
  );
  const [dailyLossType, setDailyLossType] = useState<PropValueType>(
    currentRules.maxDailyLoss?.type || "percent"
  );
  const [dailyLossBase, setDailyLossBase] = useState<PropDailyLossBase>(
    currentRules.maxDailyLoss?.base || "initialBalance"
  );

  const [drawdownVal, setDrawdownVal] = useState<string>(
    currentRules.maxTotalDrawdown?.value != null ? String(currentRules.maxTotalDrawdown.value) : "10"
  );
  const [drawdownType, setDrawdownType] = useState<PropValueType>(
    currentRules.maxTotalDrawdown?.type || "percent"
  );
  const [drawdownMode, setDrawdownMode] = useState<PropDrawdownMode>(
    currentRules.maxTotalDrawdown?.mode || "static"
  );
  const [lockAtInitial, setLockAtInitial] = useState<boolean>(
    Boolean(currentRules.maxTotalDrawdown?.lockAtInitial)
  );

  const [targetVal, setTargetVal] = useState<string>(
    currentRules.profitTarget?.value != null ? String(currentRules.profitTarget.value) : "10"
  );
  const [targetType, setTargetType] = useState<PropValueType>(
    currentRules.profitTarget?.type || "percent"
  );

  // Advanced Rules
  const [minTradingDays, setMinTradingDays] = useState<string>(
    currentRules.minTradingDays != null ? String(currentRules.minTradingDays) : "4"
  );
  const [maxTradingDays, setMaxTradingDays] = useState<string>(
    currentRules.maxTradingDays != null ? String(currentRules.maxTradingDays) : ""
  );
  const [minTradingDayMinPnl, setMinTradingDayMinPnl] = useState<string>(
    currentRules.minTradingDayMinPnl != null ? String(currentRules.minTradingDayMinPnl) : ""
  );
  const [consistencyShare, setConsistencyShare] = useState<string>(
    currentRules.consistencyRule?.maxSingleDayShare != null
      ? String(currentRules.consistencyRule.maxSingleDayShare)
      : ""
  );
  const [note, setNote] = useState<string>(currentRules.note || "");

  // Change Phase State
  const [userOutcome, setUserOutcome] = useState<PropUserOutcome>("ended");
  const [newPhaseLabel, setNewPhaseLabel] = useState("Phase 2");
  const [newPhaseBalance, setNewPhaseBalance] = useState(initialBalance);
  const [newPhaseStartedAt, setNewPhaseStartedAt] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Copy rules
  const otherPropAccounts = accounts.filter(
    (a) => a.id !== account.id && a.type === "prop" && a.propRules
  );

  const handleCopyRules = (sourceAccountId: string) => {
    const src = accounts.find((a) => a.id === sourceAccountId);
    if (!src || !src.propRules) return;
    const r = src.propRules;

    if (r.phaseLabel) setPhaseLabel(r.phaseLabel);
    if (r.initialBalance) setInitialBalance(String(r.initialBalance));
    if (r.dayReset) {
      setTz(r.dayReset.timezone);
      setResetHour(r.dayReset.hour);
    }
    if (r.maxDailyLoss) {
      setDailyLossVal(String(r.maxDailyLoss.value));
      setDailyLossType(r.maxDailyLoss.type);
      setDailyLossBase(r.maxDailyLoss.base);
    }
    if (r.maxTotalDrawdown) {
      setDrawdownVal(String(r.maxTotalDrawdown.value));
      setDrawdownType(r.maxTotalDrawdown.type);
      setDrawdownMode(r.maxTotalDrawdown.mode);
      setLockAtInitial(Boolean(r.maxTotalDrawdown.lockAtInitial));
    }
    if (r.profitTarget) {
      setTargetVal(String(r.profitTarget.value));
      setTargetType(r.profitTarget.type);
    }
    if (r.minTradingDays != null) setMinTradingDays(String(r.minTradingDays));
    if (r.maxTradingDays != null) setMaxTradingDays(String(r.maxTradingDays));
    if (r.minTradingDayMinPnl != null) setMinTradingDayMinPnl(String(r.minTradingDayMinPnl));
    if (r.consistencyRule) setConsistencyShare(String(r.consistencyRule.maxSingleDayShare));
    if (r.note) setNote(r.note);
  };

  const validateStep = (targetStep: number): boolean => {
    setErrorMessage(null);
    const initBalNum = parseFloat(initialBalance);
    if (isNaN(initBalNum) || initBalNum <= 0) {
      setErrorMessage(dict.journal.errorRequired);
      return false;
    }

    if (startedAt) {
      const startMs = new Date(startedAt).getTime();
      const nowMs = Date.now() + 24 * 60 * 60 * 1000;
      if (isNaN(startMs) || startMs > nowMs) {
        setErrorMessage(dict.journal.errorFutureDate);
        return false;
      }
    }

    if (targetStep >= 2) {
      const dlVal = parseFloat(dailyLossVal);
      if (dailyLossVal && (isNaN(dlVal) || dlVal <= 0 || (dailyLossType === "percent" && dlVal > 100))) {
        setErrorMessage(dict.journal.propRules.invalidDailyLossError);
        return false;
      }

      const ddVal = parseFloat(drawdownVal);
      if (drawdownVal && (isNaN(ddVal) || ddVal <= 0 || (drawdownType === "percent" && ddVal > 100))) {
        setErrorMessage(dict.journal.propRules.invalidDrawdownError);
        return false;
      }

      const ptVal = parseFloat(targetVal);
      if (targetVal && (isNaN(ptVal) || ptVal <= 0)) {
        setErrorMessage(dict.journal.propRules.invalidTargetError);
        return false;
      }
    }

    return true;
  };

  const handleNextStep = () => {
    if (step === 1 && validateStep(2)) setStep(2);
    else if (step === 2 && validateStep(3)) setStep(3);
  };

  const handleFinalSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(3)) return;

    const initBalNum = parseFloat(initialBalance) || 100000;
    const dlNum = parseFloat(dailyLossVal);
    const ddNum = parseFloat(drawdownVal);
    const ptNum = parseFloat(targetVal);
    const minDaysNum = parseInt(minTradingDays, 10);
    const maxDaysNum = parseInt(maxTradingDays, 10);
    const minPnlNum = parseFloat(minTradingDayMinPnl);
    const consistencyNum = parseFloat(consistencyShare);

    const newPropRules: PropRules = {
      phaseLabel: phaseLabel.trim() || "Phase 1",
      initialBalance: initBalNum,
      startedAt: new Date(startedAt).toISOString(),
      dayReset: { timezone: tz, hour: resetHour },
      maxDailyLoss: !isNaN(dlNum) && dlNum > 0 ? { type: dailyLossType, value: dlNum, base: dailyLossBase } : undefined,
      maxTotalDrawdown: !isNaN(ddNum) && ddNum > 0 ? { type: drawdownType, value: ddNum, mode: drawdownMode, lockAtInitial } : undefined,
      profitTarget: !isNaN(ptNum) && ptNum > 0 ? { type: targetType, value: ptNum } : undefined,
      minTradingDays: !isNaN(minDaysNum) && minDaysNum >= 0 ? minDaysNum : undefined,
      maxTradingDays: !isNaN(maxDaysNum) && maxDaysNum >= 0 ? maxDaysNum : undefined,
      minTradingDayMinPnl: !isNaN(minPnlNum) ? minPnlNum : undefined,
      consistencyRule: !isNaN(consistencyNum) && consistencyNum > 0 && consistencyNum <= 100 ? { maxSingleDayShare: consistencyNum } : undefined,
      note: note.trim() ? note.slice(0, 300) : undefined,
      phaseHistory: currentRules.phaseHistory || [],
    };

    const updatedAccount: Account = {
      ...account,
      startBalance: initBalNum,
      propRules: newPropRules,
    };

    onSave(updatedAccount);
    onClose();
  };

  const handleExecuteChangePhase = (e: React.FormEvent) => {
    e.preventDefault();
    const metrics = calculatePropMetrics(account, trades);

    const endedAt = new Date().toISOString();
    const archiveItem: PropPhaseArchive = {
      phaseLabel: currentRules.phaseLabel || "Phase 1",
      initialBalance: currentRules.initialBalance || account.startBalance || 100000,
      startedAt: currentRules.startedAt || account.createdAt,
      endedAt,
      userOutcome,
      finalBalance: metrics?.currentBalance ?? (account.startBalance || 100000),
      closedPnl: metrics?.accumulatedPnL ?? 0,
      tradingDays: metrics?.tradingDays?.count ?? 0,
      maxDailyLossUsedPct: metrics?.dailyLoss?.usedPct,
      maxDrawdownUsedPct: metrics?.totalDrawdown?.usedPct,
      profitTargetProgressPct: metrics?.profitTarget?.progressPct,
      note: currentRules.note,
      propRulesSnapshot: {
        phaseLabel: currentRules.phaseLabel,
        initialBalance: currentRules.initialBalance,
        profitTarget: currentRules.profitTarget,
        maxDailyLoss: currentRules.maxDailyLoss,
        maxTotalDrawdown: currentRules.maxTotalDrawdown,
        minTradingDays: currentRules.minTradingDays,
        maxTradingDays: currentRules.maxTradingDays,
        minTradingDayMinPnl: currentRules.minTradingDayMinPnl,
        consistencyRule: currentRules.consistencyRule,
        dayReset: currentRules.dayReset,
        startedAt: currentRules.startedAt || account.createdAt,
        note: currentRules.note,
      },
    };

    const existingHistory = currentRules.phaseHistory || [];
    const newHistory = [archiveItem, ...existingHistory];

    const newBalNum = parseFloat(newPhaseBalance) || parseFloat(initialBalance) || 100000;

    const newPropRules: PropRules = {
      ...currentRules,
      phaseLabel: newPhaseLabel.trim() || "Phase 2",
      initialBalance: newBalNum,
      startedAt: new Date(newPhaseStartedAt).toISOString(),
      phaseHistory: newHistory,
    };

    const updatedAccount: Account = {
      ...account,
      startBalance: newBalNum,
      propRules: newPropRules,
    };

    onSave(updatedAccount);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-lg space-y-4 shadow-xl border border-line p-5">
        <div className="flex justify-between items-center border-b border-line pb-3">
          <div>
            <h3 className="h3">{dict.journal.propRules.title}</h3>
            <span className="text-xs text-mu">{account.name || dict.journal.accountsTab.mainAccountDefaultName}</span>
          </div>
          <button onClick={onClose} className="text-mu hover:text-tx text-lg font-bold">
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        {/* Change Phase Mode */}
        {step === "changePhase" ? (
          <form onSubmit={handleExecuteChangePhase} className="space-y-4 text-xs">
            <div className="p-3 bg-vi/10 border border-vi/30 rounded-xl space-y-1">
              <h4 className="font-bold text-tx">{dict.journal.propRules.changePhase.modalTitle}</h4>
              <p className="text-mu text-[11px]">{dict.journal.propRules.changePhase.modalDesc}</p>
            </div>

            <div>
              <label className="text-mu block mb-1 font-medium">
                {dict.journal.propRules.changePhase.userOutcomeLabel}
              </label>
              <select
                value={userOutcome}
                onChange={(e) => setUserOutcome(e.target.value as PropUserOutcome)}
                className="input text-xs w-full"
              >
                <option value="passed">{dict.journal.propRules.changePhase.outcomePassed}</option>
                <option value="failed">{dict.journal.propRules.changePhase.outcomeFailed}</option>
                <option value="ended">{dict.journal.propRules.changePhase.outcomeEnded}</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-mu block mb-1 font-medium">
                  {dict.journal.propRules.wizard.phaseLabel}
                </label>
                <input
                  type="text"
                  value={newPhaseLabel}
                  onChange={(e) => setNewPhaseLabel(e.target.value)}
                  placeholder={dict.journal.propRules.wizard.phasePlaceholder}
                  className="input text-xs w-full"
                />
              </div>

              <div>
                <label className="text-mu block mb-1 font-medium">
                  {dict.journal.propRules.wizard.initialBalance}
                </label>
                <input
                  type="number"
                  value={newPhaseBalance}
                  onChange={(e) => setNewPhaseBalance(e.target.value)}
                  className="input text-xs w-full"
                />
              </div>
            </div>

            <div>
              <label className="text-mu block mb-1 font-medium">
                {dict.journal.propRules.changePhase.newPhaseStartedAt}
              </label>
              <input
                type="date"
                value={newPhaseStartedAt}
                onChange={(e) => setNewPhaseStartedAt(e.target.value)}
                className="input text-xs w-full"
              />
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn-ghost py-2 px-3 text-xs"
              >
                {dict.journal.prevBtn}
              </button>
              <button type="submit" className="btn-primary py-2 px-4 text-xs font-semibold">
                {dict.journal.propRules.changePhase.confirmBtn}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleFinalSave} className="space-y-4 text-xs">
            {/* Step Header */}
            <div className="flex rounded-xl bg-s2 border border-line p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStep(1)}
                className={`flex-1 py-1 px-2 rounded-lg transition-colors ${
                  step === 1 ? "bg-vi text-white shadow" : "text-mu hover:text-tx"
                }`}
              >
                {dict.journal.propRules.wizard.step1Title}
              </button>
              <button
                type="button"
                onClick={() => validateStep(2) && setStep(2)}
                className={`flex-1 py-1 px-2 rounded-lg transition-colors ${
                  step === 2 ? "bg-vi text-white shadow" : "text-mu hover:text-tx"
                }`}
              >
                {dict.journal.propRules.wizard.step2Title}
              </button>
              <button
                type="button"
                onClick={() => validateStep(3) && setStep(3)}
                className={`flex-1 py-1 px-2 rounded-lg transition-colors ${
                  step === 3 ? "bg-vi text-white shadow" : "text-mu hover:text-tx"
                }`}
              >
                {dict.journal.propRules.wizard.step3Title}
              </button>
            </div>

            {/* STEP 1 */}
            {step === 1 && (
              <div className="space-y-3">
                {otherPropAccounts.length > 0 && (
                  <div className="p-3 bg-s2/60 border border-line rounded-xl space-y-1.5">
                    <label className="text-[11px] text-mu flex items-center gap-1 font-medium">
                      <Copy size={12} />
                      <span>{dict.journal.propRules.wizard.copyFromAccount}</span>
                    </label>
                    <select
                      onChange={(e) => e.target.value && handleCopyRules(e.target.value)}
                      defaultValue=""
                      className="input text-xs w-full"
                    >
                      <option value="" disabled>
                        {dict.journal.propRules.wizard.selectSourceAccount}
                      </option>
                      {otherPropAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || dict.journal.accountsTab.mainAccountDefaultName} (
                          {a.propRules?.phaseLabel || "Prop"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-mu block mb-1 font-medium flex items-center justify-between">
                      <span>{dict.journal.propRules.wizard.phaseLabel}</span>
                      <span title={dict.journal.propRules.wizard.hints.phaseLabel}>
                        <HelpCircle size={12} className="text-mu" />
                      </span>
                    </label>
                    <input
                      type="text"
                      value={phaseLabel}
                      onChange={(e) => setPhaseLabel(e.target.value)}
                      placeholder={dict.journal.propRules.wizard.phasePlaceholder}
                      maxLength={40}
                      className="input text-xs w-full"
                    />
                  </div>

                  <div>
                    <label className="text-mu block mb-1 font-medium flex items-center justify-between">
                      <span>{dict.journal.propRules.wizard.initialBalance}</span>
                      <span title={dict.journal.propRules.wizard.hints.initialBalance}>
                        <HelpCircle size={12} className="text-mu" />
                      </span>
                    </label>
                    <input
                      type="number"
                      value={initialBalance}
                      onChange={(e) => setInitialBalance(e.target.value)}
                      className="input text-xs w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-mu block mb-1 font-medium flex items-center justify-between">
                    <span>{dict.journal.propRules.wizard.startedAt}</span>
                    <span title={dict.journal.propRules.wizard.hints.startedAt}>
                      <HelpCircle size={12} className="text-mu" />
                    </span>
                  </label>
                  <input
                    type="date"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    className="input text-xs w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-mu block mb-1 font-medium flex items-center justify-between">
                      <span>{dict.journal.propRules.wizard.dayResetTimezone}</span>
                      <span title={dict.journal.propRules.wizard.hints.dayReset}>
                        <HelpCircle size={12} className="text-mu" />
                      </span>
                    </label>
                    <select
                      value={tz}
                      onChange={(e) => setTz(e.target.value)}
                      className="input text-xs w-full"
                    >
                      {COMMON_TIMEZONES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-mu block mb-1 font-medium">
                      {dict.journal.propRules.wizard.dayResetHour}
                    </label>
                    <select
                      value={resetHour}
                      onChange={(e) => setResetHour(parseInt(e.target.value, 10))}
                      className="input text-xs w-full"
                    >
                      {Array.from({ length: 24 }).map((_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {currentRules.startedAt && (
                  <div className="pt-2 border-t border-line">
                    <button
                      type="button"
                      onClick={() => setStep("changePhase")}
                      className="btn-ghost text-xs py-1.5 px-3 w-full flex items-center justify-center gap-1.5 text-acc hover:text-tx"
                    >
                      <History size={13} />
                      <span>{dict.journal.propRules.changePhase.btn}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="space-y-3">
                {/* Max Daily Loss */}
                <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
                  <label className="font-bold text-tx block flex items-center justify-between">
                    <span>{dict.journal.propRules.wizard.maxDailyLoss}</span>
                    <span title={dict.journal.propRules.wizard.hints.maxDailyLoss}>
                      <HelpCircle size={12} className="text-mu" />
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={dailyLossVal}
                      onChange={(e) => setDailyLossVal(e.target.value)}
                      placeholder="5"
                      className="input text-xs w-full"
                    />
                    <select
                      value={dailyLossType}
                      onChange={(e) => setDailyLossType(e.target.value as PropValueType)}
                      className="input text-xs w-full"
                    >
                      <option value="percent">%</option>
                      <option value="money">$</option>
                    </select>
                  </div>
                  {dailyLossType === "percent" && (
                    <div>
                      <label className="text-[11px] text-mu block mb-0.5">
                        {dict.journal.propRules.wizard.maxDailyLossBase}
                      </label>
                      <select
                        value={dailyLossBase}
                        onChange={(e) => setDailyLossBase(e.target.value as PropDailyLossBase)}
                        className="input text-xs w-full"
                      >
                        <option value="initialBalance">
                          {dict.journal.propRules.wizard.baseInitial}
                        </option>
                        <option value="startOfDayBalance">
                          {dict.journal.propRules.wizard.baseStartOfDay}
                        </option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Max Total Drawdown */}
                <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
                  <label className="font-bold text-tx block flex items-center justify-between">
                    <span>{dict.journal.propRules.wizard.maxTotalDrawdown}</span>
                    <span title={dict.journal.propRules.wizard.hints.maxTotalDrawdown}>
                      <HelpCircle size={12} className="text-mu" />
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={drawdownVal}
                      onChange={(e) => setDrawdownVal(e.target.value)}
                      placeholder="10"
                      className="input text-xs w-full"
                    />
                    <select
                      value={drawdownType}
                      onChange={(e) => setDrawdownType(e.target.value as PropValueType)}
                      className="input text-xs w-full"
                    >
                      <option value="percent">%</option>
                      <option value="money">$</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-mu block mb-0.5">
                      {dict.journal.propRules.wizard.drawdownMode}
                    </label>
                    <select
                      value={drawdownMode}
                      onChange={(e) => setDrawdownMode(e.target.value as PropDrawdownMode)}
                      className="input text-xs w-full"
                    >
                      <option value="static">{dict.journal.propRules.wizard.modeStatic}</option>
                      <option value="trailingClosed">
                        {dict.journal.propRules.wizard.modeTrailingClosed}
                      </option>
                    </select>
                  </div>
                  {drawdownMode === "trailingClosed" && (
                    <label className="flex items-center gap-2 text-[11px] text-tx cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={lockAtInitial}
                        onChange={(e) => setLockAtInitial(e.target.checked)}
                        className="rounded border-line bg-s2 text-vi focus:ring-vi"
                      />
                      <span>{dict.journal.propRules.wizard.lockAtInitial}</span>
                    </label>
                  )}
                </div>

                {/* Profit Target */}
                <div className="p-3 bg-s2/40 border border-line rounded-xl space-y-2">
                  <label className="font-bold text-tx block flex items-center justify-between">
                    <span>{dict.journal.propRules.wizard.profitTarget}</span>
                    <span title={dict.journal.propRules.wizard.hints.profitTarget}>
                      <HelpCircle size={12} className="text-mu" />
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={targetVal}
                      onChange={(e) => setTargetVal(e.target.value)}
                      placeholder="10"
                      className="input text-xs w-full"
                    />
                    <select
                      value={targetType}
                      onChange={(e) => setTargetType(e.target.value as PropValueType)}
                      className="input text-xs w-full"
                    >
                      <option value="percent">%</option>
                      <option value="money">$</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-mu block mb-1 font-medium flex items-center justify-between">
                      <span>{dict.journal.propRules.wizard.minTradingDays}</span>
                      <span title={dict.journal.propRules.wizard.hints.minTradingDays}>
                        <HelpCircle size={12} className="text-mu" />
                      </span>
                    </label>
                    <input
                      type="number"
                      value={minTradingDays}
                      onChange={(e) => setMinTradingDays(e.target.value)}
                      placeholder="4"
                      className="input text-xs w-full"
                    />
                  </div>

                  <div>
                    <label className="text-mu block mb-1 font-medium">
                      {dict.journal.propRules.wizard.maxTradingDays}
                    </label>
                    <input
                      type="number"
                      value={maxTradingDays}
                      onChange={(e) => setMaxTradingDays(e.target.value)}
                      placeholder="30"
                      className="input text-xs w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-mu block mb-1 font-medium">
                      {dict.journal.propRules.wizard.minTradingDayMinPnl}
                    </label>
                    <input
                      type="number"
                      value={minTradingDayMinPnl}
                      onChange={(e) => setMinTradingDayMinPnl(e.target.value)}
                      placeholder="0"
                      className="input text-xs w-full"
                    />
                  </div>

                  <div>
                    <label className="text-mu block mb-1 font-medium flex items-center justify-between">
                      <span>{dict.journal.propRules.wizard.consistencyRule}</span>
                      <span title={dict.journal.propRules.wizard.hints.consistencyRule}>
                        <HelpCircle size={12} className="text-mu" />
                      </span>
                    </label>
                    <input
                      type="number"
                      value={consistencyShare}
                      onChange={(e) => setConsistencyShare(e.target.value)}
                      placeholder="50"
                      className="input text-xs w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-mu block mb-1 font-medium">
                    {dict.journal.propRules.wizard.note}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={dict.journal.propRules.notePlaceholder}
                    maxLength={300}
                    rows={3}
                    className="input text-xs w-full"
                  />
                </div>
              </div>
            )}

            {/* Step Navigation Footer */}
            <div className="flex justify-between items-center pt-3 border-t border-line">
              {typeof step === "number" && step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => (typeof s === "number" ? Math.max(1, s - 1) as 1 | 2 | 3 : 1))}
                  className="btn-ghost py-2 px-3 text-xs"
                >
                  ← {dict.journal.prevBtn}
                </button>
              ) : (
                <button type="button" onClick={onClose} className="btn-ghost py-2 px-3 text-xs">
                  {dict.journal.cancel}
                </button>
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="btn-primary py-2 px-4 text-xs font-semibold flex items-center gap-1"
                >
                  <span>{dict.journal.nextBtn}</span>
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button type="submit" className="btn-primary py-2 px-5 text-xs font-semibold flex items-center gap-1">
                  <Check size={14} />
                  <span>{dict.journal.save}</span>
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
