"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Starfield } from "@/components/Starfield";
import { Character } from "@/components/Character";
import { isValidLatinNickname, transliterateNickname } from "@/lib/stats";
import {
  SKIN_TONES,
  HAIRSTYLES,
  HAIR_COLORS,
  OUTFITS,
  AvatarAppearance,
  DEFAULT_AVATAR_APPEARANCE,
  validateAvatarAppearance,
} from "@/lib/avatar";
import {
  getQuestionsForStep,
  getFilteredOptions,
  QuestionDefinition,
} from "@/lib/awakening";
import {
  acquireLease,
  renewLease,
  stealLease,
  releaseLease,
  isLeaseOwner,
  getLeaseInfo,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/auth/awakening-lease";
import { currentTabId, authTabChannel } from "@/lib/auth/tab-channel";
import { AppStorage } from "@/lib/storage";
import { shouldOfferProfileSelect } from "@/lib/storage/profile-transfer";
import { ArrowLeft, ArrowRight, SkipForward, Check, Globe, Sparkles, Loader2, AlertCircle, Lock, Plus, RotateCcw, Shuffle, X } from "lucide-react";
import { formatString } from "@/lib/i18n";
import { cn } from "@/components/ui/cn";
import { deriveScene, progressOf } from "@/lib/awakening-scene";
import { AwakeningHeader } from "@/components/awakening/AwakeningHeader";
import { AwakeningStage } from "@/components/awakening/AwakeningStage";
import { AwakeningFinale } from "@/components/awakening/AwakeningFinale";
import { AnswerCard, optionIcon } from "@/components/awakening/AnswerCard";
import { TimezoneSelect } from "@/components/TimezoneSelect";

/** Set once the finale animation has played (per storage space), so a reload shows the final frame at once. */
const FINALE_PLAYED_KEY = "ayra_awakening_finale_played";


export default function AwakeningPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEditMode = searchParams.get("mode") === "edit";

  const { dict, lang, setLanguage } = useApp();
  const {
    gameState,
    saveOnboardingAnswer,
    setOnboardingStep,
    completeOnboarding,
    updateAvatarAppearance,
    updateMinorMode,
  } = useGame();

  const { user, profile, checkNicknameAvailable, saveNickname, signOut } = useAuth();

  const [step, setStep] = useState<number>(gameState.onboarding.step || 1);
  const [subStep, setSubStep] = useState<number>(gameState.onboarding.subStep || 0);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);

  // Multi-tab Lease & Read-Only State
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);
  const leaseBtnRef = useRef<HTMLButtonElement | null>(null);

  const [answers, setAnswers] = useState<Record<string, any>>({
    nickname: profile?.nickname || gameState.name || "",
    language: lang || "ru",
    timezone:
      gameState.profile.timezone ||
      (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC"),
    appearance: validateAvatarAppearance(gameState.profile.appearance),
    ageRange: gameState.profile.minorMode ? "16-17" : gameState.onboarding.answers.ageRange || "",
    ...gameState.onboarding.answers,
  });

  const [customInputText, setCustomInputText] = useState<string>("");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [checkingNickname, setCheckingNickname] = useState<boolean>(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const wasAlreadyDone = gameState.onboarding.status === "done";

  // Lease management & multi-tab protection
  useEffect(() => {
    // Attempt lease acquisition on mount
    const acquired = acquireLease(currentTabId);
    if (!acquired) {
      setIsReadOnly(true);
    }

    // Heartbeat renewal timer
    const interval = setInterval(() => {
      const owner = isLeaseOwner(currentTabId);
      if (owner) {
        renewLease(currentTabId);
        setIsReadOnly(false);
      } else {
        setIsReadOnly(true);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Storage event listener for lease or tab channel changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "ayra_awakening_lease") {
        const owner = isLeaseOwner(currentTabId);
        setIsReadOnly(!owner);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    const unsubscribeChannel = authTabChannel.subscribe((msg) => {
      if (msg.type === "AUTH_CLAIMED") {
        const owner = isLeaseOwner(currentTabId);
        setIsReadOnly(!owner);
      }
    });

    // A reload or closing the tab frees the lease at once (otherwise the reloaded page would wait for the TTL in read-only mode)
    const handlePageHide = () => releaseLease(currentTabId);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("pagehide", handlePageHide);
      unsubscribeChannel();
      releaseLease(currentTabId);
    };
  }, []);

  // Auto focus "Continue here" button when becoming read-only
  useEffect(() => {
    if (isReadOnly) {
      leaseBtnRef.current?.focus();
    }
  }, [isReadOnly]);

  const handleStealLease = () => {
    stealLease(currentTabId);
    setIsReadOnly(false);

    // Re-read latest onboarding state from AppStorage before continuing
    try {
      const saved = AppStorage.getItem("ayra_demo_v1");
      if (saved) {
        const current = JSON.parse(saved);
        if (current.onboarding) {
          if (current.onboarding.step) setStep(current.onboarding.step);
          if (current.onboarding.subStep !== undefined) setSubStep(current.onboarding.subStep);
          if (current.onboarding.answers) {
            setAnswers((prev) => ({ ...prev, ...current.onboarding.answers }));
          }
        }
      }
    } catch {}

    authTabChannel.broadcast("AUTH_CLAIMED");
  };

  useEffect(() => {
    setOnboardingStep(step, subStep);
  }, [step, subStep, setOnboardingStep]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step, subStep]);

  const questionsForStep = useMemo(() => getQuestionsForStep(step), [step]);

  const currentQuestion: QuestionDefinition | undefined = questionsForStep[subStep];

  const minorMode = answers.ageRange === "16-17" || gameState.profile.minorMode;

  const currentOptions = useMemo(() => {
    if (!currentQuestion?.options) return [];
    return getFilteredOptions(currentQuestion.options, minorMode);
  }, [currentQuestion, minorMode]);

  const handleAnswerChange = (key: string, value: any) => {
    if (isReadOnly) return;
    const updated = { ...answers, [key]: value };
    setAnswers(updated);
    saveOnboardingAnswer(key, value);

    if (key === "ageRange") {
      updateMinorMode(value === "16-17");
    }
  };

  // Stable callback: the picker fills in the browser zone once when the answer is still empty
  const onTimezoneChange = useCallback((tz: string) => {
    if (isReadOnly) return;
    setAnswers((prev) => ({ ...prev, timezone: tz }));
    saveOnboardingAnswer("timezone", tz);
  }, [saveOnboardingAnswer, isReadOnly]);

  const handleNicknameChange = (val: string) => {
    if (isReadOnly) return;
    setNicknameError(null);
    handleAnswerChange("nickname", val);
  };

  const handleTransliterateNickname = () => {
    if (isReadOnly) return;
    if (answers.nickname) {
      const transliterated = transliterateNickname(answers.nickname);
      setNicknameError(null);
      handleAnswerChange("nickname", transliterated);
    }
  };

  const handleSingleSelect = (questionId: string, optionId: string) => {
    if (isReadOnly) return;
    handleAnswerChange(questionId, optionId);
  };

  const handleMultiToggle = (questionId: string, optionId: string) => {
    if (isReadOnly) return;
    const currentList: string[] = Array.isArray(answers[questionId])
      ? answers[questionId]
      : [];
    const exists = currentList.includes(optionId);
    const updated = exists
      ? currentList.filter((item) => item !== optionId)
      : [...currentList, optionId];
    handleAnswerChange(questionId, updated);
  };

  const handleAddCustomOption = (questionId: string) => {
    if (isReadOnly) return;
    const trimmed = customInputText.trim();
    if (!trimmed) return;
    const currentList: string[] = Array.isArray(answers[questionId])
      ? answers[questionId]
      : [];
    if (!currentList.includes(trimmed)) {
      handleAnswerChange(questionId, [...currentList, trimmed]);
    }
    setCustomInputText("");
  };

  const handleRemoveCustomOption = (questionId: string, item: string) => {
    if (isReadOnly) return;
    const currentList: string[] = Array.isArray(answers[questionId])
      ? answers[questionId]
      : [];
    handleAnswerChange(
      questionId,
      currentList.filter((i) => i !== item)
    );
  };

  const canGoNext = useMemo(() => {
    if (isReadOnly) return false;
    if (step === 5) return true;
    if (!currentQuestion) return true;

    if (currentQuestion.id === "nickname") {
      const nick = answers.nickname?.trim() || "";
      return nick.length >= 3 && nick.length <= 24 && isValidLatinNickname(nick) && !nicknameError;
    }

    if (currentQuestion.id === "language_timezone") {
      return !!answers.language && !!answers.timezone;
    }

    if (currentQuestion.id === "ageRange") {
      return !!answers.ageRange;
    }

    if (currentQuestion.mandatory) {
      const val = answers[currentQuestion.id];
      if (Array.isArray(val)) return val.length > 0;
      return typeof val === "string" ? val.trim().length > 0 : !!val;
    }

    return true;
  }, [step, currentQuestion, answers, nicknameError, isReadOnly]);

  const validateNicknameUniqueness = async (nick: string): Promise<boolean> => {
    setCheckingNickname(true);
    const available = await checkNicknameAvailable(nick);
    setCheckingNickname(false);

    if (!available) {
      setNicknameError(dict.awakening.q.nickname.errorNicknameTaken);
      return false;
    }
    return true;
  };

  const handleNextSubStep = async () => {
    if (isReadOnly || !canGoNext || checkingNickname) return;

    if (currentQuestion?.id === "nickname") {
      const nick = answers.nickname?.trim() || "";
      const ok = await validateNicknameUniqueness(nick);
      if (!ok) return;

      if (user) {
        await saveNickname(nick);
      }
    }

    if (subStep < questionsForStep.length - 1) {
      setSubStep(subStep + 1);
    } else {
      if (step < 5) {
        setStep(step + 1);
        setSubStep(0);
      } else {
        handleFinishOnboarding();
      }
    }
  };

  const handlePrevSubStep = () => {
    if (isReadOnly) return;
    if (subStep > 0) {
      setSubStep(subStep - 1);
    } else if (step > 1) {
      const prevStepQuestions = getQuestionsForStep(step - 1);
      setStep(step - 1);
      setSubStep(prevStepQuestions.length - 1);
    }
  };

  const handleSkipSubStep = () => {
    if (isReadOnly) return;
    if (subStep < questionsForStep.length - 1) {
      setSubStep(subStep + 1);
    } else if (step < 5) {
      setStep(step + 1);
      setSubStep(0);
    }
  };

  const handleSkipEntireStep = () => {
    if (isReadOnly) return;
    if (step < 5) {
      setStep(step + 1);
      setSubStep(0);
    }
  };

  const handleSkipOptionalInStep3 = () => {
    if (isReadOnly) return;
    setStep(4);
    setSubStep(0);
  };

  const handleFinishOnboarding = async () => {
    if (isReadOnly || isNavigating) return;
    setIsNavigating(true);

    const nick = answers.nickname?.trim() || gameState.name || "";
    if (user && nick) {
      await saveNickname(nick);
    }

    const nowIso = new Date().toISOString();
    completeOnboarding();

    try {
      const saved = AppStorage.getItem("ayra_demo_v1");
      const current = saved ? JSON.parse(saved) : {};
      current.onboarding = {
        ...current.onboarding,
        status: "done",
        step: 5,
        subStep: 0,
        finishedAt: nowIso,
      };
      if (nick) {
        current.name = nick;
      }
      AppStorage.setItem("ayra_demo_v1", JSON.stringify(current));
    } catch {
      // ignore
    }

    // A guest profile on this device is offered for transfer only now, after the account's own onboarding.
    const targetUrl = isEditMode
      ? "/settings"
      : user && shouldOfferProfileSelect(user.id)
      ? "/profile-select"
      : "/";
    router.replace(targetUrl);

    setTimeout(() => {
      if (typeof window !== "undefined" && window.location.pathname === "/awakening") {
        window.location.assign(targetUrl);
      }
    }, 800);
  };


  /** Option label from its dictionary key ("awakening.exp.less_than_1" → dict.awakening.exp.less_than_1). */
  const optionLabel = (labelKey: string, fallback: string): string => {
    const [group, key] = labelKey.replace("awakening.", "").split(".");
    const table = (dict.awakening as unknown as Record<string, Record<string, string> | undefined>)[group];
    return table?.[key] || fallback;
  };

  /** Short description under an answer, where the dictionary has one. */
  const optionDescription = (labelKey: string): string | undefined => {
    const [group, key] = labelKey.replace("awakening.", "").split(".");
    const table = (dict.awakening.wow.desc as Record<string, Record<string, string> | undefined>)[group];
    return table?.[key];
  };

  const updateAppearance = (updated: AvatarAppearance) => {
    handleAnswerChange("appearance", updated);
    updateAvatarAppearance(updated);
  };

  const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

  const renderQuestionInput = () => {
    if (step === 5) {
      // Edit mode or an already finished onboarding: no animation, just a calm final card.
      return (
        <div className="space-y-6 py-2 text-center md:text-left">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-vi/50 bg-vi/20 text-vi shadow-lg shadow-vi/20 md:mx-0">
            <Sparkles size={28} aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="font-serif text-3xl font-bold text-tx md:text-4xl">{dict.awakening.finalTitle}</h2>
            <p className="text-sm text-mu md:text-base">{dict.awakening.finalSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleFinishOnboarding}
            disabled={isNavigating || isReadOnly}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pri via-[#6b4bb4] to-pri text-base font-semibold text-white shadow-[0_10px_30px_-8px_rgba(163,138,209,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-wait disabled:opacity-70"
          >
            {isNavigating ? (
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />
            ) : (
              <>
                <span>{isEditMode ? dict.awakening.returnToSettingsBtn : dict.awakening.startBtn}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      );
    }

    if (!currentQuestion) return null;

    if (currentQuestion.id === "nickname") {
      const nick: string = answers.nickname || "";
      const isLatin = nick.length > 0 && isValidLatinNickname(nick);
      const isLengthValid = nick.length >= 3 && nick.length <= 24;
      const allOk = isLatin && isLengthValid && !nicknameError;
      const Rule = ({ ok, text }: { ok: boolean; text: string }) => (
        <li className={cn("flex items-center gap-2 text-sm transition-colors", ok ? "text-long" : "text-mu")}>
          <span className={cn("grid h-5 w-5 place-items-center rounded-full border", ok ? "border-long/60 bg-long/15" : "border-edge")} aria-hidden="true">
            {ok ? <Check size={12} strokeWidth={3} /> : <span className="h-1 w-1 rounded-full bg-mu" />}
          </span>
          <span>{text}</span>
        </li>
      );

      return (
        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={nick}
              onChange={(e) => handleNicknameChange(e.target.value)}
              placeholder={dict.awakening.q.nickname.placeholder}
              aria-label={dict.awakening.q.nickname.title}
              aria-invalid={!!nicknameError || (nick.length > 0 && !isLatin)}
              aria-describedby="nick-rules"
              disabled={isReadOnly}
              maxLength={24}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "h-[60px] w-full rounded-xl border bg-field pl-4 pr-20 font-serif text-xl tracking-wide text-tx transition-colors placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-mu/60",
                "focus:outline-none focus:ring-2 focus:ring-vi/60 disabled:opacity-50",
                nicknameError || (nick.length > 0 && !isLatin) ? "border-short/70" : allOk ? "border-long/60" : "border-edge focus:border-vi"
              )}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs tabular-nums text-mu" aria-hidden="true">
              {formatString(dict.awakening.wow.nickname.counter, { count: nick.length })}
            </span>
          </div>

          <ul id="nick-rules" className="space-y-1.5" aria-live="polite">
            <Rule ok={isLatin} text={dict.awakening.wow.nickname.checkLatin} />
            <Rule ok={isLengthValid} text={dict.awakening.wow.nickname.checkLength} />
          </ul>

          {allOk && <p className="text-sm font-semibold text-vi motion-safe:animate-[ayraFade_250ms_ease-out]">{dict.awakening.wow.nickname.ok}</p>}

          {nicknameError && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-short/40 bg-short/10 p-3 text-sm text-short">
              <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
              <span>{nicknameError}</span>
            </div>
          )}

          {nick && !isValidLatinNickname(nick) && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-vi/40 bg-vi/10 p-3 text-sm text-tx">
              <span>{dict.awakening.q.nickname.errorLatin}</span>
              <button
                type="button"
                onClick={handleTransliterateNickname}
                disabled={isReadOnly}
                className="shrink-0 rounded-lg border border-vi/50 px-3 py-1.5 text-xs font-semibold text-tx hover:bg-vi/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50"
              >
                {dict.awakening.transliterateBtn}
              </button>
            </div>
          )}
        </div>
      );
    }

    if (currentQuestion.id === "language_timezone") {
      return (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-mu" id="lang-label">
              {dict.awakening.q.language_timezone.languageLabel}
            </p>
            <div role="radiogroup" aria-labelledby="lang-label" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["ru", "en"] as const).map((l) => (
                <AnswerCard
                  key={l}
                  label={l === "ru" ? dict.awakening.russianLabel : dict.awakening.englishLabel}
                  icon={Globe}
                  selected={lang === l}
                  disabled={isReadOnly}
                  onClick={() => {
                    if (isReadOnly) return;
                    setLanguage(l);
                    handleAnswerChange("language", l);
                  }}
                />
              ))}
            </div>
          </div>
          <TimezoneSelect
            id="tz-input"
            label={dict.awakening.q.language_timezone.timezoneLabel}
            value={answers.timezone}
            disabled={isReadOnly}
            onChange={onTimezoneChange}
          />
        </div>
      );
    }

    if (currentQuestion.id === "appearance") {
      // Single source of truth: the saved profile appearance (answers.appearance is kept in sync by updateAvatarAppearance).
      const currentApp: AvatarAppearance = gameState.profile.appearance;
      const swatch = (selected: boolean) =>
        cn(
          "h-9 w-9 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-50",
          selected ? "scale-110 border-tx shadow-[0_0_0_3px_rgb(var(--c-vi)/0.6)]" : "border-transparent hover:scale-105"
        );
      const sectionTitle = "mb-2 text-xs font-semibold uppercase tracking-wide text-mu";

      return (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() =>
                updateAppearance({
                  skinTone: pick(SKIN_TONES).id,
                  hairstyle: pick(HAIRSTYLES).id,
                  hairColor: pick(HAIR_COLORS).id,
                  outfit: pick(OUTFITS).id,
                })
              }
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-edge bg-field px-3 text-sm font-semibold text-tx hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50"
            >
              <Shuffle size={16} aria-hidden="true" />
              {dict.awakening.wow.appearance.random}
            </button>
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() => updateAppearance({ ...DEFAULT_AVATAR_APPEARANCE })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-edge bg-field px-3 text-sm font-semibold text-mu hover:border-vi hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50"
            >
              <RotateCcw size={16} aria-hidden="true" />
              {dict.awakening.wow.appearance.reset}
            </button>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <section>
              <h3 className={sectionTitle}>{dict.avatar.skinToneLabel}</h3>
              <div className="flex flex-wrap gap-2.5">
                {SKIN_TONES.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    disabled={isReadOnly}
                    aria-pressed={currentApp.skinTone === st.id}
                    aria-label={(dict.avatar as unknown as Record<string, string>)[st.id] || st.id}
                    title={(dict.avatar as unknown as Record<string, string>)[st.id] || st.id}
                    onClick={() => updateAppearance({ ...currentApp, skinTone: st.id })}
                    style={{ backgroundColor: st.hex }}
                    className={swatch(currentApp.skinTone === st.id)}
                  />
                ))}
              </div>
            </section>
            <section>
              <h3 className={sectionTitle}>{dict.avatar.hairColorLabel}</h3>
              <div className="flex flex-wrap gap-2.5">
                {HAIR_COLORS.map((hc) => (
                  <button
                    key={hc.id}
                    type="button"
                    disabled={isReadOnly}
                    aria-pressed={currentApp.hairColor === hc.id}
                    aria-label={(dict.avatar as unknown as Record<string, string>)[hc.id] || hc.id}
                    title={(dict.avatar as unknown as Record<string, string>)[hc.id] || hc.id}
                    onClick={() => updateAppearance({ ...currentApp, hairColor: hc.id })}
                    style={{ backgroundColor: hc.hex }}
                    className={swatch(currentApp.hairColor === hc.id)}
                  />
                ))}
              </div>
            </section>
          </div>

          <section>
            <h3 className={sectionTitle}>{dict.avatar.hairstyleLabel}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HAIRSTYLES.map((hs) => {
                const selected = currentApp.hairstyle === hs.id;
                return (
                  <button
                    key={hs.id}
                    type="button"
                    disabled={isReadOnly}
                    aria-pressed={selected}
                    onClick={() => updateAppearance({ ...currentApp, hairstyle: hs.id })}
                    className={cn(
                      "flex min-h-[44px] items-center justify-center rounded-lg border px-2 py-2 text-center text-xs font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50",
                      selected ? "border-vi bg-vi/20 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
                    )}
                  >
                    {(dict.avatar as unknown as Record<string, string>)[hs.id] || hs.id}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className={sectionTitle}>{dict.avatar.outfitLabel}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {OUTFITS.map((o) => {
                const selected = currentApp.outfit === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={isReadOnly}
                    aria-pressed={selected}
                    onClick={() => updateAppearance({ ...currentApp, outfit: o.id })}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50",
                      selected ? "border-vi bg-vi/20 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
                    )}
                  >
                    <span className="grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded bg-ink/60" aria-hidden="true">
                      <Character appearance={{ ...currentApp, outfit: o.id }} equipment={{}} size="avatar" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{(dict.avatar as unknown as Record<string, string>)[o.id] || o.id}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      );
    }

    if (currentQuestion.type === "single" || currentQuestion.type === "multi") {
      const multi = currentQuestion.type === "multi";
      const selectedList: string[] = multi && Array.isArray(answers[currentQuestion.id]) ? answers[currentQuestion.id] : [];
      return (
        <div role={multi ? "group" : "radiogroup"} aria-label={questionTitle} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          {currentOptions.map((opt) => {
            const selected = multi ? selectedList.includes(opt.id) : answers[currentQuestion.id] === opt.id;
            return (
              <AnswerCard
                key={opt.id}
                label={optionLabel(opt.labelKey, opt.id)}
                description={optionDescription(opt.labelKey)}
                icon={optionIcon(currentQuestion.id, opt.id)}
                selected={selected}
                multi={multi}
                disabled={isReadOnly}
                onClick={() => (multi ? handleMultiToggle(currentQuestion.id, opt.id) : handleSingleSelect(currentQuestion.id, opt.id))}
              />
            );
          })}
        </div>
      );
    }

    if (currentQuestion.type === "custom_multi" || currentQuestion.type === "custom_select") {
      const selectedList: string[] = Array.isArray(answers[currentQuestion.id]) ? answers[currentQuestion.id] : [];
      const placeholder = (dict.awakening.q as unknown as Record<string, { placeholder?: string } | undefined>)[currentQuestion.id]?.placeholder || dict.awakening.customPlaceholder;
      const customItems = selectedList.filter((item) => !currentOptions.some((o) => o.id === item));

      return (
        <div className="space-y-4">
          {currentOptions.length > 0 && (
            <div role="group" aria-label={questionTitle} className="flex flex-wrap gap-2">
              {currentOptions.map((opt) => {
                const selected = selectedList.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    disabled={isReadOnly}
                    onClick={() => handleMultiToggle(currentQuestion.id, opt.id)}
                    className={cn(
                      "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50",
                      selected ? "border-vi bg-vi/20 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
                    )}
                  >
                    {selected && <Check size={14} strokeWidth={3} className="text-vi" aria-hidden="true" />}
                    <span>{optionLabel(opt.labelKey, opt.id)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customInputText}
              disabled={isReadOnly}
              aria-label={placeholder}
              onChange={(e) => setCustomInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomOption(currentQuestion.id);
                }
              }}
              placeholder={placeholder}
              className="h-12 min-w-0 flex-1 rounded-xl border border-edge bg-field px-4 text-sm text-tx focus:border-vi focus:outline-none focus:ring-2 focus:ring-vi/60 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={isReadOnly || !customInputText.trim()}
              onClick={() => handleAddCustomOption(currentQuestion.id)}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl border border-vi/50 bg-vi/15 px-4 text-sm font-semibold text-tx hover:bg-vi/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-40"
            >
              <Plus size={16} aria-hidden="true" />
              {dict.awakening.addBtn}
            </button>
          </div>

          {customItems.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {customItems.map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-vi bg-vi/20 py-1.5 pl-3.5 pr-1.5 text-sm font-medium text-tx">
                  <span>{item}</span>
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => handleRemoveCustomOption(currentQuestion.id, item)}
                    aria-label={formatString(dict.awakening.wow.removeItem, { item })}
                    className="grid h-6 w-6 place-items-center rounded-full text-mu hover:bg-white/10 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (currentQuestion.type === "text") {
      const textVal: string = answers[currentQuestion.id] || "";
      const maxLen = currentQuestion.maxLength || 200;
      const placeholder = (dict.awakening.q as unknown as Record<string, { placeholder?: string } | undefined>)[currentQuestion.id]?.placeholder || "";

      return (
        <div className="space-y-2">
          <textarea
            value={textVal}
            disabled={isReadOnly}
            aria-label={questionTitle}
            onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value.slice(0, maxLen))}
            placeholder={placeholder}
            rows={5}
            maxLength={maxLen}
            className="w-full resize-none rounded-xl border border-edge bg-field p-4 text-base text-tx placeholder:text-mu/60 focus:border-vi focus:outline-none focus:ring-2 focus:ring-vi/60 disabled:opacity-50"
          />
          <div className="text-right text-xs tabular-nums text-mu">
            {textVal.length} / {maxLen}
          </div>
        </div>
      );
    }

    return null;
  };

  const questionTitle: string =
    currentQuestion && (dict.awakening.q as unknown as Record<string, { title?: string } | undefined>)[currentQuestion.id]?.title
      ? (dict.awakening.q as unknown as Record<string, { title: string }>)[currentQuestion.id].title
      : "";
  const questionSub: string = currentQuestion ? (dict.awakening.wow.sub as Record<string, string>)[currentQuestion.id] || "" : "";

  const hasAnsweredCurrent = useMemo(() => {
    if (!currentQuestion) return false;
    const val = answers[currentQuestion.id];
    if (Array.isArray(val)) return val.length > 0;
    return typeof val === "string" ? val.trim().length > 0 : !!val;
  }, [currentQuestion, answers]);

  // Stage mood follows the answers; the character itself is always the saved appearance + equipment.
  const scene = useMemo(
    () => deriveScene(answers, progressOf(step, subStep, questionsForStep.length)),
    [answers, step, subStep, questionsForStep.length]
  );

  // The finale animation plays once; after a reload on the final step the final frame is shown at once.
  const showFinale = step === 5 && !wasAlreadyDone && !isEditMode;
  const [finalePlayed, setFinalePlayed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!showFinale) return;
    try {
      setFinalePlayed(AppStorage.getItem(FINALE_PLAYED_KEY) === "1");
    } catch {
      setFinalePlayed(false);
    }
  }, [showFinale]);
  const markFinalePlayed = useCallback(() => {
    try {
      AppStorage.setItem(FINALE_PLAYED_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  const finaleSummary = useMemo(() => {
    const f = dict.awakening.wow.finale;
    const label = (group: string, id: string) =>
      (dict.awakening as unknown as Record<string, Record<string, string> | undefined>)[group]?.[id] || id;
    const rows: { label: string; value: string }[] = [];
    if (typeof answers.tradingStyle === "string" && answers.tradingStyle) rows.push({ label: f.summaryStyle, value: label("style", answers.tradingStyle) });
    if (Array.isArray(answers.tradingGoal) && answers.tradingGoal.length > 0)
      rows.push({ label: f.summaryGoals, value: (answers.tradingGoal as string[]).map((g) => label("goal", g)).join(", ") });
    if (typeof answers.mainProblem === "string" && answers.mainProblem) rows.push({ label: f.summaryFocus, value: label("problem", answers.mainProblem) });
    return rows;
  }, [answers, dict]);

  const canGoBack = !(step === 1 && subStep === 0) && !isReadOnly;

  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || showFinale) return;
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      if (canGoBack) {
        e.preventDefault();
        handlePrevSubStep();
      }
      return;
    }
    // Enter continues — but not inside a textarea or on a button/link (they have their own Enter).
    if (e.key === "Enter" && !["TEXTAREA", "BUTTON", "A"].includes(target.tagName) && step <= 4 && canGoNext && !checkingNickname && !isReadOnly) {
      e.preventDefault();
      handleNextSubStep();
    }
  };

  const leaseBanner = isReadOnly && (
    <div
      aria-live="polite"
      className="relative z-50 flex shrink-0 flex-col items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-xs text-amber-200 shadow-lg backdrop-blur-md sm:flex-row"
    >
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <div>
          <span className="font-semibold">{dict.awakening.multiTabLeaseNoticeTitle}. </span>
          <span className="text-amber-300/80">{dict.awakening.multiTabLeaseNoticeSubtitle}</span>
        </div>
      </div>
      <button
        ref={leaseBtnRef}
        type="button"
        onClick={handleStealLease}
        className="shrink-0 cursor-pointer rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-amber-400"
      >
        {dict.awakening.continueHereBtn}
      </button>
    </div>
  );

  if (showFinale) {
    return (
      <div className="relative min-h-[100dvh] w-full overflow-hidden bg-[#050409] text-tx">
        <div className="fixed inset-x-0 top-0 z-50">{leaseBanner}</div>
        {finalePlayed !== null && (
          <AwakeningFinale
            appearance={gameState.profile.appearance}
            equipment={gameState.equipment}
            nickname={answers.nickname?.trim() || gameState.name || ""}
            summary={finaleSummary}
            onStart={handleFinishOnboarding}
            isNavigating={isNavigating || isReadOnly}
            alreadyPlayed={finalePlayed}
            onPlayed={markFinalePlayed}
            startLabel={dict.awakening.startBtn}
          />
        )}
      </div>
    );
  }

  const skipBtn =
    "inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-mu hover:bg-white/5 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-30";

  // One grid for header, content and footer: --aw-pad is the side padding, --aw-col the question column width
  return (
    <div
      className="relative z-0 flex h-[100dvh] w-full flex-col overflow-hidden bg-ink text-tx [--aw-col:620px] [--aw-pad:16px] md:[--aw-pad:40px] lg:[--aw-pad:64px]"
      onKeyDown={onRootKeyDown}
    >
      <Starfield />
      {leaseBanner}

      <AwakeningHeader
        step={step}
        subStep={subStep}
        questionsInStep={questionsForStep.length}
        onGoToStep={(st) => {
          if (isReadOnly || st >= step) return;
          setStep(st);
          setSubStep(0);
        }}
        email={user?.email}
        onSignOut={() => signOut()}
        readOnly={isReadOnly}
        editMode={isEditMode}
        returnLabel={dict.awakening.returnToSettingsBtn}
      />

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {step <= 4 && questionTitle ? formatString(dict.awakening.wow.stepAnnounce, { step, title: questionTitle }) : dict.awakening.finalTitle}
      </p>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[45%_minmax(0,1fr)]">
        <div className="shrink-0 px-[var(--aw-pad)] pt-3 md:h-full md:p-0">
          <AwakeningStage
            appearance={gameState.profile.appearance}
            equipment={gameState.equipment}
            scene={scene}
            label={dict.awakening.wow.stageLabel}
            className="h-[35dvh] md:h-full md:rounded-none md:border-y-0 md:border-l-0"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[var(--aw-pad)] py-5 [scrollbar-width:none] md:py-8 [&::-webkit-scrollbar]:hidden">
            <div key={`${step}-${subStep}`} data-testid="awakening-content" className="mx-auto my-auto w-full max-w-[var(--aw-col)] motion-safe:animate-[ayraFade_300ms_ease-out]">
              {step <= 4 && currentQuestion && (
                <div className="mb-5 space-y-2 md:mb-7">
                  <h1 ref={titleRef} tabIndex={-1} className="font-serif text-[28px] font-bold leading-tight text-tx focus:outline-none md:text-[40px]">
                    {questionTitle}
                  </h1>
                  {questionSub && <p className="text-sm text-mu md:text-base">{questionSub}</p>}
                </div>
              )}
              {renderQuestionInput()}
            </div>
          </main>

          {step <= 4 && (
            <footer className="relative z-20 shrink-0 border-t border-line/40 bg-ink/90 px-[var(--aw-pad)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
              <div className="mx-auto flex w-full max-w-[var(--aw-col)] items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevSubStep}
                  disabled={!canGoBack}
                  className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl border border-edge px-3.5 text-sm font-semibold text-tx hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-30 sm:px-4"
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  <span>{dict.awakening.back}</span>
                </button>

                <div className="ml-auto flex min-w-0 items-center gap-1">
                  {(step === 2 || step === 4) && (
                    <button type="button" onClick={handleSkipEntireStep} disabled={isReadOnly} aria-label={dict.awakening.skipEntireStep} title={dict.awakening.skipEntireStep} className={skipBtn}>
                      <SkipForward size={16} aria-hidden="true" />
                      <span className="hidden lg:inline">{dict.awakening.skipEntireStep}</span>
                    </button>
                  )}
                  {step === 3 && subStep >= 3 && (
                    <button type="button" onClick={handleSkipOptionalInStep3} disabled={isReadOnly} aria-label={dict.awakening.skipOptionalQuestions} title={dict.awakening.skipOptionalQuestions} className={skipBtn}>
                      <SkipForward size={16} aria-hidden="true" />
                      <span className="hidden lg:inline">{dict.awakening.skipOptionalQuestions}</span>
                    </button>
                  )}
                  {currentQuestion && !currentQuestion.mandatory && !hasAnsweredCurrent && (
                    <button type="button" onClick={handleSkipSubStep} disabled={isReadOnly} className={skipBtn}>
                      {dict.awakening.skipQuestion}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleNextSubStep}
                  disabled={!canGoNext || checkingNickname || isReadOnly}
                  className="inline-flex h-12 min-w-[132px] shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pri to-[#6b4bb4] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(163,138,209,0.8)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[160px]"
                >
                  {checkingNickname ? (
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <>
                      <span>{dict.awakening.continue}</span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
