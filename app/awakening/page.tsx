"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Starfield } from "@/components/Starfield";
import { Figure } from "@/components/Figure";
import { isValidLatinNickname, transliterateNickname } from "@/lib/stats";
import {
  SKIN_TONES,
  HAIRSTYLES,
  HAIR_COLORS,
  OUTFITS,
  AvatarAppearance,
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
import { ArrowLeft, ArrowRight, SkipForward, Check, Globe, Sparkles, FastForward, Loader2, AlertCircle, LogOut, Lock } from "lucide-react";
import { formatString, formatNumber } from "@/lib/i18n";

function AwakeningCanvasAnimation({
  appearance,
  equipment,
  skipText,
  startText,
  onComplete,
  isNavigating,
}: {
  appearance: AvatarAppearance;
  equipment: Record<string, number>;
  skipText: string;
  startText: string;
  onComplete: () => void;
  isNavigating: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"dark" | "spiral" | "bloom" | "final">("dark");

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setPhase("final");
      return;
    }

    const t1 = setTimeout(() => setPhase("spiral"), 300);
    const t2 = setTimeout(() => setPhase("bloom"), 1500);
    const t3 = setTimeout(() => setPhase("final"), 2400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || phase === "final") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || 400);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 400);

    const particles = Array.from({ length: 70 }).map(() => ({
      angle: Math.random() * Math.PI * 2,
      radius: 120 + Math.random() * 100,
      speed: 0.03 + Math.random() * 0.02,
      size: 1.5 + Math.random() * 2,
      alpha: Math.random() * 0.8 + 0.2,
    }));

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;

      particles.forEach((p) => {
        p.angle += p.speed;
        p.radius = Math.max(0, p.radius - 1.2);

        const x = centerX + Math.cos(p.angle) * p.radius;
        const y = centerY + Math.sin(p.angle) * p.radius;

        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(163, 138, 209, ${p.alpha})`;
        ctx.fill();
      });

      if (phase === "bloom") {
        const gradient = ctx.createRadialGradient(
          centerX,
          centerY,
          10,
          centerX,
          centerY,
          180
        );
        gradient.addColorStop(0, "rgba(80, 52, 143, 0.5)");
        gradient.addColorStop(0.5, "rgba(163, 138, 209, 0.2)");
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [phase]);

  return (
    <div className="relative w-full max-w-md mx-auto flex flex-col items-center justify-center space-y-6">
      {phase !== "final" && (
        <button
          onClick={() => setPhase("final")}
          className="absolute top-0 right-0 z-30 btn-ghost text-xs py-1.5 px-3 flex items-center gap-1 text-mu hover:text-tx cursor-pointer"
        >
          <span>{skipText}</span>
          <FastForward size={14} />
        </button>
      )}

      <div className="relative w-56 h-72 rounded-2xl grid place-items-center bg-radial-gradient from-s1 via-ink to-ink overflow-hidden border border-vi/30 shadow-2xl shadow-vi/20">
        <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />

        <div
          className={`absolute inset-0 bg-radial-gradient from-vi/40 via-pri/20 to-transparent transition-opacity duration-1000 ${
            phase === "bloom" || phase === "final" ? "opacity-100" : "opacity-0"
          }`}
        />

        <div className="relative z-20 transition-all duration-1000">
          <Figure
            appearance={appearance}
            equipment={equipment}
            width={120}
            height={200}
            className={
              phase === "dark" || phase === "spiral"
                ? "brightness-0 opacity-40 transition-all duration-1000"
                : "brightness-100 opacity-100 transition-all duration-1000 drop-shadow-[0_0_20px_rgba(163,138,209,0.5)]"
            }
          />
        </div>

        {(phase === "bloom" || phase === "final") && (
          <div className="absolute top-3 right-3 z-30 w-8 h-8 rounded-lg bg-go/20 border-2 border-go text-go font-serif text-xs font-bold flex items-center justify-center shadow-lg shadow-go/30 animate-pulse">
            1
          </div>
        )}
      </div>

      <div
        className={`w-full transition-all duration-700 ${
          phase === "final" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
      >
        <button
          type="button"
          onClick={onComplete}
          disabled={isNavigating}
          className="group relative w-full h-[56px] min-w-[220px] rounded-2xl font-semibold text-base text-white overflow-hidden transition-all duration-200 active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait shadow-[0_8px_24px_rgba(80,52,143,0.5)] border-t border-go/60 bg-gradient-to-r from-vi via-pri to-vi hover:brightness-110 flex items-center justify-center gap-2 cursor-pointer"
        >
          <span className="absolute inset-0 w-1/2 h-full bg-white/20 skew-x-[-20deg] -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000 ease-out pointer-events-none motion-reduce:hidden" />

          {isNavigating ? (
            <Loader2 size={20} className="animate-spin text-white" />
          ) : (
            <>
              <span>{startText}</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

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

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", handleStorageChange);
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

  const renderQuestionInput = () => {
    if (step === 5) {
      if (!wasAlreadyDone && !isEditMode) {
        return (
          <div className="space-y-6 max-w-md mx-auto py-2">
            <AwakeningCanvasAnimation
              appearance={validateAvatarAppearance(answers.appearance)}
              equipment={gameState.equipment}
              skipText={dict.awakening.skipQuestion}
              startText={dict.awakening.startBtn}
              onComplete={handleFinishOnboarding}
              isNavigating={isNavigating || isReadOnly}
            />
          </div>
        );
      }

      return (
        <div className="text-center space-y-6 py-4 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-vi/20 border border-vi/50 text-vi flex items-center justify-center mx-auto shadow-lg shadow-vi/20">
            <Sparkles size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-tx">
              {dict.awakening.finalTitle}
            </h2>
            <p className="text-sm text-mu">
              {dict.awakening.finalSubtitle}
            </p>
          </div>

          <div className="pt-4 flex flex-col items-center">
            <button
              type="button"
              onClick={handleFinishOnboarding}
              disabled={isNavigating || isReadOnly}
              className="group relative w-full h-[56px] min-w-[220px] rounded-2xl font-semibold text-base text-white overflow-hidden transition-all duration-200 active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait shadow-[0_8px_24px_rgba(80,52,143,0.5)] border-t border-go/60 bg-gradient-to-r from-vi via-pri to-vi hover:brightness-110 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="absolute inset-0 w-1/2 h-full bg-white/20 skew-x-[-20deg] -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000 ease-out pointer-events-none motion-reduce:hidden" />
              {isNavigating ? (
                <Loader2 size={20} className="animate-spin text-white" />
              ) : (
                <>
                  <span>
                    {isEditMode
                      ? dict.awakening.returnToSettingsBtn
                      : dict.awakening.startBtn}
                  </span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </div>
      );
    }

    if (!currentQuestion) return null;

    if (currentQuestion.id === "nickname") {
      const nick = answers.nickname || "";
      const isLatin = isValidLatinNickname(nick);
      const isLengthValid = nick.length >= 3 && nick.length <= 24;

      return (
        <div className="space-y-3 max-w-[640px] mx-auto">
          <div>
            <input
              type="text"
              value={nick}
              onChange={(e) => handleNicknameChange(e.target.value)}
              placeholder={dict.awakening.q.nickname.placeholder}
              disabled={isReadOnly}
              className="w-full bg-s2 border border-line rounded-xl p-3.5 text-base text-tx focus:outline-none focus:border-vi focus:ring-1 focus:ring-vi disabled:opacity-50"
              maxLength={24}
              autoFocus
            />
            <div className="text-xs text-mu mt-2 text-center">
              {dict.awakening.q.nickname.rules}
            </div>
          </div>

          {nicknameError && (
            <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <AlertCircle size={16} className="text-red-400 shrink-0" />
              <span>{nicknameError}</span>
            </div>
          )}

          {nick && !isLatin && (
            <div className="flex items-center justify-between text-xs text-go bg-go/10 border border-go/30 rounded-xl p-3">
              <span>{dict.awakening.q.nickname.errorLatin}</span>
              <button
                type="button"
                onClick={handleTransliterateNickname}
                disabled={isReadOnly}
                className="btn-ghost text-[11px] py-1 px-2 border border-go/40 text-go hover:bg-go/20 cursor-pointer disabled:opacity-50"
              >
                {dict.awakening.transliterateBtn}
              </button>
            </div>
          )}

          {nick && isLatin && !isLengthValid && (
            <div className="text-xs text-go bg-go/10 border border-go/30 rounded-xl p-3">
              {dict.awakening.q.nickname.errorLength}
            </div>
          )}
        </div>
      );
    }

    if (currentQuestion.id === "language_timezone") {
      return (
        <div className="space-y-5 max-w-[640px] mx-auto text-left">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-mu block">
              {dict.awakening.q.language_timezone.languageLabel}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  if (isReadOnly) return;
                  setLanguage("ru");
                  handleAnswerChange("language", "ru");
                }}
                className={`p-3.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
                  lang === "ru"
                    ? "border-vi bg-vi/20 text-tx shadow-md shadow-vi/10 ring-1 ring-vi"
                    : "border-line bg-s2/60 text-mu hover:border-line/80"
                }`}
              >
                <Globe size={16} />
                <span>{dict.awakening.russianLabel}</span>
              </button>
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  if (isReadOnly) return;
                  setLanguage("en");
                  handleAnswerChange("language", "en");
                }}
                className={`p-3.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
                  lang === "en"
                    ? "border-vi bg-vi/20 text-tx shadow-md shadow-vi/10 ring-1 ring-vi"
                    : "border-line bg-s2/60 text-mu hover:border-line/80"
                }`}
              >
                <Globe size={16} />
                <span>{dict.awakening.englishLabel}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-mu block">
              {dict.awakening.q.language_timezone.timezoneLabel}
            </label>
            <input
              type="text"
              value={answers.timezone || ""}
              disabled={isReadOnly}
              onChange={(e) => handleAnswerChange("timezone", e.target.value)}
              className="w-full bg-s2 border border-line rounded-xl p-3.5 text-sm text-tx focus:outline-none focus:border-vi disabled:opacity-50"
            />
          </div>
        </div>
      );
    }

    if (currentQuestion.id === "appearance") {
      const currentApp: AvatarAppearance = validateAvatarAppearance(
        answers.appearance
      );

      return (
        <div className="w-full max-w-[1120px] mx-auto py-2">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-12 items-center">
            <div className="lg:col-span-6 flex flex-col items-center justify-center">
              <div className="relative w-full max-w-[420px] lg:max-w-none lg:min-w-[380px] h-[min(46vh,360px)] lg:h-[calc(100vh-280px)] lg:min-h-[460px] lg:max-h-[680px] rounded-3xl bg-radial-gradient from-pri/40 via-s1 to-s1 overflow-hidden border border-vi/40 shadow-2xl shadow-vi/20 grid place-items-center p-6">
                <div className="absolute bottom-4 lg:bottom-6 w-32 lg:w-48 h-5 lg:h-7 rounded-full border border-vi/50 bg-vi/30 shadow-2xl shadow-vi/60 blur-[1px]" />

                <Figure
                  appearance={currentApp}
                  rotateSlowly
                  className="h-[85%] w-auto relative z-10"
                />
              </div>
            </div>

            <div className="lg:col-span-6 w-full lg:min-w-[400px] lg:max-w-[540px] space-y-5 text-left bg-s1/80 border border-line p-5 md:p-6 rounded-3xl shadow-xl">
              <div className="space-y-2">
                <label className="text-xs font-bold text-tx block">
                  {dict.avatar.skinToneLabel}
                </label>
                <div className="flex flex-wrap gap-2">
                  {SKIN_TONES.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        const updated = { ...currentApp, skinTone: st.id };
                        handleAnswerChange("appearance", updated);
                        updateAvatarAppearance(updated);
                      }}
                      style={{ backgroundColor: st.hex }}
                      className={`w-7 h-7 md:w-8 md:h-8 rounded-full border-2 transition-all cursor-pointer disabled:opacity-50 ${
                        currentApp.skinTone === st.id
                          ? "border-vi scale-110 ring-2 ring-vi/60 shadow-lg shadow-vi/30"
                          : "border-transparent opacity-80 hover:opacity-100 hover:scale-105"
                      }`}
                      aria-label={(dict.avatar as any)[st.id] || st.id}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-tx block">
                  {dict.avatar.hairColorLabel}
                </label>
                <div className="flex flex-wrap gap-2">
                  {HAIR_COLORS.map((hc) => (
                    <button
                      key={hc.id}
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        const updated = { ...currentApp, hairColor: hc.id };
                        handleAnswerChange("appearance", updated);
                        updateAvatarAppearance(updated);
                      }}
                      style={{ backgroundColor: hc.hex }}
                      className={`w-7 h-7 md:w-8 md:h-8 rounded-full border-2 transition-all cursor-pointer disabled:opacity-50 ${
                        currentApp.hairColor === hc.id
                          ? "border-vi scale-110 ring-2 ring-vi/60 shadow-lg shadow-vi/30"
                          : "border-transparent opacity-80 hover:opacity-100 hover:scale-105"
                      }`}
                      aria-label={(dict.avatar as any)[hc.id] || hc.id}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-tx block">
                  {dict.avatar.hairstyleLabel}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {HAIRSTYLES.map((hs) => (
                    <button
                      key={hs.id}
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        const updated = { ...currentApp, hairstyle: hs.id };
                        handleAnswerChange("appearance", updated);
                        updateAvatarAppearance(updated);
                      }}
                      className={`p-2 min-h-[44px] rounded-xl border text-[11px] leading-tight font-medium text-center flex items-center justify-center transition-all cursor-pointer disabled:opacity-50 ${
                        currentApp.hairstyle === hs.id
                          ? "border-vi bg-vi/20 text-tx font-bold ring-1 ring-vi shadow-md"
                          : "border-line bg-s2/60 text-mu hover:border-vi/50 hover:bg-s2"
                      }`}
                    >
                      <span>{(dict.avatar as any)[hs.id] || hs.id}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-tx block">
                  {dict.avatar.outfitLabel}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {OUTFITS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        const updated = { ...currentApp, outfit: o.id };
                        handleAnswerChange("appearance", updated);
                        updateAvatarAppearance(updated);
                      }}
                      className={`p-2.5 rounded-xl border text-xs font-medium flex items-center justify-between transition-all cursor-pointer disabled:opacity-50 ${
                        currentApp.outfit === o.id
                          ? "border-vi bg-vi/20 text-tx font-bold ring-1 ring-vi shadow-md"
                          : "border-line bg-s2/60 text-mu hover:border-vi/50 hover:bg-s2"
                      }`}
                    >
                      <span className="truncate mr-1">{(dict.avatar as any)[o.id] || o.id}</span>
                      <div className="flex items-center gap-1 flex-none">
                        <span className="w-3 h-3 rounded-full border border-black/20" style={{ backgroundColor: o.topColor }} />
                        <span className="w-3 h-3 rounded-full border border-black/20" style={{ backgroundColor: o.bottomColor }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (currentQuestion.type === "single") {
      const selectedValue = answers[currentQuestion.id];
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[640px] mx-auto">
          {currentOptions.map((opt) => {
            const isSelected = selectedValue === opt.id;
            const labelKeyShort = opt.labelKey.replace("awakening.", "");
            const parts = labelKeyShort.split(".");
            let label = opt.id;
            try {
              label = (dict.awakening as any)[parts[0]][parts[1]] || opt.id;
            } catch {
              label = opt.id;
            }

            return (
              <button
                key={opt.id}
                type="button"
                disabled={isReadOnly}
                onClick={() => handleSingleSelect(currentQuestion.id, opt.id)}
                className={`min-h-[52px] p-4 rounded-xl border text-sm font-semibold flex items-center justify-between text-left transition-all duration-200 cursor-pointer disabled:opacity-50 ${
                  isSelected
                    ? "border-vi bg-vi/20 text-tx shadow-lg shadow-vi/15 ring-1 ring-vi"
                    : "border-line bg-s2/70 text-mu hover:border-vi/50 hover:bg-s2 hover:text-tx"
                }`}
              >
                <span className="leading-snug">{label}</span>
                {isSelected && <Check size={18} className="text-vi flex-none ml-2" />}
              </button>
            );
          })}
        </div>
      );
    }

    if (currentQuestion.type === "multi") {
      const selectedList: string[] = Array.isArray(answers[currentQuestion.id])
        ? answers[currentQuestion.id]
        : [];

      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[640px] mx-auto">
          {currentOptions.map((opt) => {
            const isSelected = selectedList.includes(opt.id);
            const labelKeyShort = opt.labelKey.replace("awakening.", "");
            const parts = labelKeyShort.split(".");
            let label = opt.id;
            try {
              label = (dict.awakening as any)[parts[0]][parts[1]] || opt.id;
            } catch {
              label = opt.id;
            }

            return (
              <button
                key={opt.id}
                type="button"
                disabled={isReadOnly}
                onClick={() => handleMultiToggle(currentQuestion.id, opt.id)}
                className={`min-h-[52px] p-4 rounded-xl border text-sm font-semibold flex items-center justify-between text-left transition-all duration-200 cursor-pointer disabled:opacity-50 ${
                  isSelected
                    ? "border-vi bg-vi/20 text-tx shadow-lg shadow-vi/15 ring-1 ring-vi"
                    : "border-line bg-s2/70 text-mu hover:border-vi/50 hover:bg-s2 hover:text-tx"
                }`}
              >
                <span className="leading-snug">{label}</span>
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ml-2 flex-none ${
                    isSelected ? "border-vi bg-vi text-white" : "border-line bg-s1"
                  }`}
                >
                  {isSelected && <Check size={14} className="text-white" />}
                </div>
              </button>
            );
          })}
        </div>
      );
    }

    if (
      currentQuestion.type === "custom_multi" ||
      currentQuestion.type === "custom_select"
    ) {
      const selectedList: string[] = Array.isArray(answers[currentQuestion.id])
        ? answers[currentQuestion.id]
        : [];

      const placeholder =
        (dict.awakening.q as any)[currentQuestion.id]?.placeholder || dict.awakening.customPlaceholder;

      return (
        <div className="space-y-4 max-w-[640px] mx-auto">
          {currentOptions.length > 0 && (
            <div className="flex flex-wrap gap-2.5 justify-center">
              {currentOptions.map((opt) => {
                const isSelected = selectedList.includes(opt.id);
                const labelKeyShort = opt.labelKey.replace("awakening.", "");
                const parts = labelKeyShort.split(".");
                let label = opt.id;
                try {
                  label = (dict.awakening as any)[parts[0]][parts[1]] || opt.id;
                } catch {
                  label = opt.id;
                }

                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => handleMultiToggle(currentQuestion.id, opt.id)}
                    className={`min-h-[44px] px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
                      isSelected
                        ? "border-vi bg-vi/25 text-tx font-bold ring-1 ring-vi shadow-md shadow-vi/15"
                        : "border-line bg-s2/70 text-mu hover:border-vi/50 hover:bg-s2 hover:text-tx"
                    }`}
                  >
                    <span>{label}</span>
                    {isSelected && <Check size={14} className="text-vi flex-none" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <input
              type="text"
              value={customInputText}
              disabled={isReadOnly}
              onChange={(e) => setCustomInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomOption(currentQuestion.id);
                }
              }}
              placeholder={placeholder}
              className="flex-1 bg-s2 border border-line rounded-xl p-3.5 text-xs text-tx focus:outline-none focus:border-vi disabled:opacity-50"
            />
            <button
              type="button"
              disabled={isReadOnly}
              onClick={() => handleAddCustomOption(currentQuestion.id)}
              className="btn text-xs py-3.5 px-5 flex-none cursor-pointer disabled:opacity-50"
            >
              {dict.awakening.addBtn}
            </button>
          </div>

          {selectedList.filter((item) => !currentOptions.some((o) => o.id === item)).length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {selectedList
                .filter((item) => !currentOptions.some((o) => o.id === item))
                .map((item) => (
                  <span
                    key={item}
                    className="chip bg-vi/20 border-vi text-tx py-2 px-3.5 text-xs flex items-center gap-2 font-medium"
                  >
                    <span>{item}</span>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => handleRemoveCustomOption(currentQuestion.id, item)}
                      className="text-mu hover:text-tx text-sm font-bold cursor-pointer disabled:opacity-50"
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          )}
        </div>
      );
    }

    if (currentQuestion.type === "text") {
      const textVal = answers[currentQuestion.id] || "";
      const maxLen = currentQuestion.maxLength || 200;
      const placeholder =
        (dict.awakening.q as any)[currentQuestion.id]?.placeholder || "";

      return (
        <div className="space-y-2 max-w-[640px] mx-auto text-left">
          <textarea
            value={textVal}
            disabled={isReadOnly}
            onChange={(e) =>
              handleAnswerChange(currentQuestion.id, e.target.value.slice(0, maxLen))
            }
            placeholder={placeholder}
            rows={4}
            className="w-full bg-s2 border border-line rounded-xl p-3.5 text-sm text-tx focus:outline-none focus:border-vi resize-none disabled:opacity-50"
            maxLength={maxLen}
          />
          <div className="text-right text-xs text-mu">
            {textVal.length} / {maxLen}
          </div>
        </div>
      );
    }

    return null;
  };

  const questionTitle =
    currentQuestion && (dict.awakening.q as any)[currentQuestion.id]?.title
      ? (dict.awakening.q as any)[currentQuestion.id].title
      : "";

  const hasAnsweredCurrent = useMemo(() => {
    if (!currentQuestion) return false;
    const val = answers[currentQuestion.id];
    if (Array.isArray(val)) return val.length > 0;
    return typeof val === "string" ? val.trim().length > 0 : !!val;
  }, [currentQuestion, answers]);

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col bg-ink text-tx relative z-0 select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      onKeyDown={(e) => {
        if (e.key === "Enter" && canGoNext && !checkingNickname && !isReadOnly) {
          e.preventDefault();
          handleNextSubStep();
        }
      }}
    >
      <Starfield />

      {/* Multi-Tab Read-Only Lease Banner */}
      {isReadOnly && (
        <div
          aria-live="polite"
          className="relative z-30 bg-amber-500/15 border-b border-amber-500/40 px-4 py-2.5 text-amber-200 text-xs flex flex-col sm:flex-row items-center justify-between gap-2 shadow-lg backdrop-blur-md"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-400 shrink-0" />
            <div>
              <span className="font-semibold">{dict.awakening.multiTabLeaseNoticeTitle}. </span>
              <span className="text-amber-300/80">{dict.awakening.multiTabLeaseNoticeSubtitle}</span>
            </div>
          </div>
          <button
            ref={leaseBtnRef}
            type="button"
            onClick={handleStealLease}
            className="rounded-lg bg-amber-500 hover:bg-amber-400 text-ink font-semibold px-3 py-1.5 text-xs transition cursor-pointer shrink-0"
          >
            {dict.awakening.continueHereBtn}
          </button>
        </div>
      )}

      <header className="relative z-20 flex flex-col justify-center px-4 md:px-8 border-b border-line/40 bg-ink/80 backdrop-blur-md flex-none py-2 space-y-1 max-h-[80px]">
        <div className="flex items-center justify-between gap-3 md:gap-4">
          <Link href="/" className="font-serif text-lg font-bold tracking-wider text-tx hover:opacity-80 flex-none">
            AYRA
          </Link>

          <div className="flex-1 min-w-[80px] max-w-xl mx-auto grid grid-cols-5 gap-1.5 md:gap-2 items-center">
            {[1, 2, 3, 4, 5].map((st) => {
              const isPast = st < step;
              const isCurrent = st === step;

              let barClass = "bg-white/10";
              if (isPast) barClass = "bg-vi";
              if (isCurrent) barClass = "bg-gradient-to-r from-vi to-go shadow-sm shadow-vi/50";

              return (
                <div key={st} className="flex flex-col items-center">
                  <div className={`h-2 w-full rounded-full transition-all duration-300 ${barClass}`} />
                  <div
                    className={`text-[11px] font-medium truncate hidden md:block mt-1 ${
                      isCurrent ? "text-tx font-bold" : "text-mu"
                    }`}
                  >
                    {(dict.awakening.stepNames as any)[`step${st}`]}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-none">
            {/* User Email & Logout Badge (Always enabled even in read-only mode) */}
            {user && (
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-tx-muted bg-s2/80 px-2 py-1 rounded-lg border border-line">
                <span className="hidden lg:inline whitespace-nowrap">{dict.auth.headerUserEmail}:</span>
                <span
                  className="hidden sm:inline font-mono text-tx font-medium truncate max-w-[120px] lg:max-w-[220px]"
                  title={user.email}
                >
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={() => signOut()}
                  aria-label={dict.topbar.logout}
                  title={dict.topbar.logout}
                  className="flex items-center gap-1 text-red-400 hover:text-red-300 font-semibold cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{dict.topbar.logout}</span>
                </button>
              </div>
            )}

            <div className="flex items-center gap-1 bg-s2/80 p-0.5 rounded-lg border border-line">
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  if (isReadOnly) return;
                  setLanguage("ru");
                }}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-50 ${
                  lang === "ru" ? "bg-vi text-white" : "text-mu hover:text-tx"
                }`}
              >
                RU
              </button>
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  if (isReadOnly) return;
                  setLanguage("en");
                }}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-50 ${
                  lang === "en" ? "bg-vi text-white" : "text-mu hover:text-tx"
                }`}
              >
                EN
              </button>
            </div>

            {isEditMode && (
              <Link
                href="/settings"
                className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1"
              >
                <span>{dict.awakening.returnToSettingsBtn}</span>
              </Link>
            )}
          </div>
        </div>

        {step <= 4 && (
          <div className="text-center text-[12px] text-mu font-medium leading-none py-0.5">
            {formatString(dict.awakening.questionProgress, {
              step: formatNumber(lang, step),
              subStep: formatNumber(lang, subStep + 1),
              totalSubSteps: formatNumber(lang, questionsForStep.length),
            })}
          </div>
        )}
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 flex flex-col items-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-full max-w-4xl mx-auto my-auto text-center space-y-4">
          {step <= 4 && currentQuestion && (
            <div className="space-y-1">
              <h1
                ref={titleRef}
                tabIndex={-1}
                className="font-serif text-2xl md:text-[30px] font-bold text-tx leading-tight focus:outline-none"
              >
                {questionTitle}
              </h1>
            </div>
          )}

          <div className="pt-2">{renderQuestionInput()}</div>
        </div>
      </main>

      {step <= 4 && (
        <footer className="relative z-20 p-3.5 md:px-8 border-t border-line/40 bg-ink/80 backdrop-blur-md flex-none">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handlePrevSubStep}
              disabled={(step === 1 && subStep === 0) || isReadOnly}
              className="btn-ghost text-xs py-2.5 px-4 flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ArrowLeft size={16} />
              <span>{dict.awakening.back}</span>
            </button>

            <div className="flex items-center gap-2">
              {(step === 2 || step === 4) && (
                <button
                  type="button"
                  onClick={handleSkipEntireStep}
                  disabled={isReadOnly}
                  className="btn-ghost text-xs py-2.5 px-3 flex items-center gap-1.5 text-mu hover:text-tx cursor-pointer disabled:opacity-30"
                >
                  <SkipForward size={14} />
                  <span className="hidden sm:inline">
                    {dict.awakening.skipEntireStep}
                  </span>
                </button>
              )}

              {step === 3 && subStep >= 3 && (
                <button
                  type="button"
                  onClick={handleSkipOptionalInStep3}
                  disabled={isReadOnly}
                  className="btn-ghost text-xs py-2.5 px-3 flex items-center gap-1.5 text-mu hover:text-tx cursor-pointer disabled:opacity-30"
                >
                  <SkipForward size={14} />
                  <span className="hidden sm:inline">
                    {dict.awakening.skipOptionalQuestions}
                  </span>
                </button>
              )}

              {currentQuestion && !currentQuestion.mandatory && !hasAnsweredCurrent && (
                <button
                  type="button"
                  onClick={handleSkipSubStep}
                  disabled={isReadOnly}
                  className="btn-ghost text-xs py-2.5 px-4 text-mu hover:text-tx cursor-pointer disabled:opacity-30"
                >
                  {dict.awakening.skipQuestion}
                </button>
              )}

              <button
                type="button"
                onClick={handleNextSubStep}
                disabled={!canGoNext || checkingNickname || isReadOnly}
                className="btn text-xs py-2.5 px-5 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-vi/20 cursor-pointer"
              >
                {checkingNickname ? (
                  <Loader2 size={16} className="animate-spin text-white" />
                ) : (
                  <>
                    <span>{dict.awakening.continue}</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
