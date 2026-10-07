"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
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
import { ArrowLeft, ArrowRight, SkipForward, Check, Globe, Sparkles, FastForward } from "lucide-react";
import { formatString, formatNumber } from "@/lib/i18n";

function AwakeningCanvasAnimation({
  appearance,
  equipment,
  skipText,
  startText,
  onComplete,
}: {
  appearance: AvatarAppearance;
  equipment: Record<string, number>;
  skipText: string;
  startText: string;
  onComplete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"dark" | "spiral" | "bloom" | "final">("dark");

  useEffect(() => {
    // Check reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setPhase("final");
      return;
    }

    const t1 = setTimeout(() => setPhase("spiral"), 400);
    const t2 = setTimeout(() => setPhase("bloom"), 1800);
    const t3 = setTimeout(() => setPhase("final"), 3000);

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
          onClick={() => {
            setPhase("final");
          }}
          className="absolute top-0 right-0 z-30 btn-ghost text-xs py-1.5 px-3 flex items-center gap-1 text-mu hover:text-tx"
        >
          <span>{skipText}</span>
          <FastForward size={14} />
        </button>
      )}

      <div className="relative w-56 h-72 rounded-2xl grid place-items-center bg-radial-gradient from-s1 via-ink to-ink overflow-hidden border border-vi/30 shadow-2xl shadow-vi/20">
        <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />

        {/* Aura Bloom Effect */}
        <div
          className={`absolute inset-0 bg-radial-gradient from-vi/40 via-pri/20 to-transparent transition-opacity duration-1000 ${
            phase === "bloom" || phase === "final" ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Character Silhouette vs Full Color */}
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

        {/* Level 1 Octagonal Gold Badge */}
        {(phase === "bloom" || phase === "final") && (
          <div className="absolute top-3 right-3 z-30 w-8 h-8 rounded-lg bg-go/20 border-2 border-go text-go font-serif text-xs font-bold flex items-center justify-center shadow-lg shadow-go/30 animate-pulse">
            1
          </div>
        )}
      </div>

      <div
        className={`transition-all duration-1000 ${
          phase === "final" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
      >
        <button
          onClick={onComplete}
          className="btn w-full py-3.5 px-8 text-sm font-bold shadow-xl shadow-vi/40 bg-gradient-to-r from-vi via-pri to-vi hover:opacity-90 transition-all"
        >
          {startText}
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

  const [step, setStep] = useState<number>(gameState.onboarding.step || 1);
  const [subStep, setSubStep] = useState<number>(gameState.onboarding.subStep || 0);

  const [answers, setAnswers] = useState<Record<string, any>>({
    nickname: gameState.name || "",
    language: lang || "ru",
    timezone:
      gameState.profile.timezone ||
      (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC"),
    appearance: validateAvatarAppearance(gameState.profile.appearance),
    ageRange: gameState.profile.minorMode ? "16-17" : gameState.onboarding.answers.ageRange || "",
    ...gameState.onboarding.answers,
  });

  const [customInputText, setCustomInputText] = useState<string>("");
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Initial completion check vs re-edit mode
  const wasAlreadyDone = gameState.onboarding.status === "done";

  // Sync step/subStep state changes to GameContext & localStorage
  useEffect(() => {
    setOnboardingStep(step, subStep);
  }, [step, subStep, setOnboardingStep]);

  // Focus title when transitioning screens
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
    const updated = { ...answers, [key]: value };
    setAnswers(updated);
    saveOnboardingAnswer(key, value);

    if (key === "ageRange") {
      updateMinorMode(value === "16-17");
    }
  };

  const handleNicknameChange = (val: string) => {
    handleAnswerChange("nickname", val);
  };

  const handleTransliterateNickname = () => {
    if (answers.nickname) {
      const transliterated = transliterateNickname(answers.nickname);
      handleAnswerChange("nickname", transliterated);
    }
  };

  const handleSingleSelect = (questionId: string, optionId: string) => {
    handleAnswerChange(questionId, optionId);
  };

  const handleMultiToggle = (questionId: string, optionId: string) => {
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
    const currentList: string[] = Array.isArray(answers[questionId])
      ? answers[questionId]
      : [];
    handleAnswerChange(
      questionId,
      currentList.filter((i) => i !== item)
    );
  };

  const canGoNext = useMemo(() => {
    if (step === 5) return true;
    if (!currentQuestion) return true;

    if (currentQuestion.id === "nickname") {
      const nick = answers.nickname?.trim() || "";
      return nick.length >= 3 && nick.length <= 24 && isValidLatinNickname(nick);
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
  }, [step, currentQuestion, answers]);

  const handleNextSubStep = () => {
    if (!canGoNext) return;

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
    if (subStep > 0) {
      setSubStep(subStep - 1);
    } else if (step > 1) {
      const prevStepQuestions = getQuestionsForStep(step - 1);
      setStep(step - 1);
      setSubStep(prevStepQuestions.length - 1);
    }
  };

  const handleSkipSubStep = () => {
    if (subStep < questionsForStep.length - 1) {
      setSubStep(subStep + 1);
    } else if (step < 5) {
      setStep(step + 1);
      setSubStep(0);
    }
  };

  const handleSkipEntireStep = () => {
    if (step < 5) {
      setStep(step + 1);
      setSubStep(0);
    }
  };

  const handleSkipOptionalInStep3 = () => {
    setStep(4);
    setSubStep(0);
  };

  const handleFinishOnboarding = () => {
    completeOnboarding();

    // Synchronous fallback persistence to localStorage to guarantee status='done' before redirect
    try {
      const saved = localStorage.getItem("ayra_demo_v1");
      const current = saved ? JSON.parse(saved) : {};
      current.onboarding = {
        ...current.onboarding,
        status: "done",
        finishedAt: new Date().toISOString(),
      };
      localStorage.setItem("ayra_demo_v1", JSON.stringify(current));
    } catch {
      // ignore
    }

    if (isEditMode) {
      router.replace("/settings");
    } else {
      router.replace("/");
    }
  };

  const renderQuestionInput = () => {
    if (step === 5) {
      if (!wasAlreadyDone && !isEditMode) {
        return (
          <div className="space-y-6 max-w-md mx-auto py-4">
            <AwakeningCanvasAnimation
              appearance={validateAvatarAppearance(answers.appearance)}
              equipment={gameState.equipment}
              skipText={dict.awakening.skipQuestion}
              startText={dict.awakening.startBtn}
              onComplete={handleFinishOnboarding}
            />
          </div>
        );
      }

      return (
        <div className="text-center space-y-6 py-6 max-w-md mx-auto">
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

          <div className="pt-4 flex flex-col gap-3">
            <button
              onClick={handleFinishOnboarding}
              className="btn w-full py-3 text-sm font-semibold shadow-lg shadow-vi/30"
            >
              {isEditMode
                ? dict.awakening.returnToSettingsBtn
                : dict.awakening.startBtn}
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
        <div className="space-y-3 max-w-md mx-auto">
          <div>
            <input
              type="text"
              value={nick}
              onChange={(e) => handleNicknameChange(e.target.value)}
              placeholder={dict.awakening.q.nickname.placeholder}
              className="w-full bg-s2 border border-line rounded-xl p-3 text-sm text-tx focus:outline-none focus:border-vi focus:ring-1 focus:ring-vi"
              maxLength={24}
              autoFocus
            />
            <div className="text-xs text-mu mt-2 text-center">
              {dict.awakening.q.nickname.rules}
            </div>
          </div>

          {nick && !isLatin && (
            <div className="flex items-center justify-between text-xs text-go bg-go/10 border border-go/30 rounded-xl p-3">
              <span>{dict.awakening.q.nickname.errorLatin}</span>
              <button
                type="button"
                onClick={handleTransliterateNickname}
                className="btn-ghost text-[11px] py-1 px-2 border border-go/40 text-go hover:bg-go/20"
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
        <div className="space-y-4 max-w-md mx-auto text-left">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-mu block">
              {dict.awakening.q.language_timezone.languageLabel}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setLanguage("ru");
                  handleAnswerChange("language", "ru");
                }}
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  lang === "ru"
                    ? "border-vi bg-vi/20 text-tx shadow-sm"
                    : "border-line bg-s2/60 text-mu hover:border-line/80"
                }`}
              >
                <Globe size={14} />
                <span>{dict.awakening.russianLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLanguage("en");
                  handleAnswerChange("language", "en");
                }}
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  lang === "en"
                    ? "border-vi bg-vi/20 text-tx shadow-sm"
                    : "border-line bg-s2/60 text-mu hover:border-line/80"
                }`}
              >
                <Globe size={14} />
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
              onChange={(e) => handleAnswerChange("timezone", e.target.value)}
              className="w-full bg-s2 border border-line rounded-xl p-3 text-sm text-tx focus:outline-none focus:border-vi"
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
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-center w-full max-w-5xl mx-auto">
          {/* Figure Preview Column: min 420px on xl, 70% window height */}
          <div className="xl:col-span-6 flex flex-col items-center justify-center p-6 rounded-3xl bg-s2/90 border border-vi/40 shadow-2xl shadow-vi/20 min-h-[380px] xl:min-h-[480px] xl:w-[420px] mx-auto">
            <div className="relative w-full h-[320px] xl:h-[400px] rounded-2xl grid place-items-center bg-radial-gradient from-pri/50 via-s1 to-s1 overflow-hidden border border-vi/30">
              <div className="absolute bottom-4 w-40 h-6 rounded-full border border-vi/60 bg-vi/30 shadow-lg shadow-vi/50" />
              <Figure
                appearance={currentApp}
                rotateSlowly
                className="h-[85%] w-auto"
              />
            </div>
          </div>

          {/* Compact Right Selector Column */}
          <div className="xl:col-span-6 space-y-3 text-left">
            {/* Skin Tone & Hair Color in 1 Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-mu block">
                  {dict.avatar.skinToneLabel}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SKIN_TONES.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        const updated = { ...currentApp, skinTone: st.id };
                        handleAnswerChange("appearance", updated);
                        updateAvatarAppearance(updated);
                      }}
                      style={{ backgroundColor: st.hex }}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        currentApp.skinTone === st.id
                          ? "border-vi scale-110 ring-2 ring-vi/40"
                          : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                      aria-label={(dict.avatar as any)[st.id] || st.id}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-mu block">
                  {dict.avatar.hairColorLabel}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {HAIR_COLORS.map((hc) => (
                    <button
                      key={hc.id}
                      type="button"
                      onClick={() => {
                        const updated = { ...currentApp, hairColor: hc.id };
                        handleAnswerChange("appearance", updated);
                        updateAvatarAppearance(updated);
                      }}
                      style={{ backgroundColor: hc.hex }}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        currentApp.hairColor === hc.id
                          ? "border-vi scale-110 ring-2 ring-vi/40"
                          : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                      aria-label={(dict.avatar as any)[hc.id] || hc.id}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Hairstyles in 4x2 Grid */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-mu block">
                {dict.avatar.hairstyleLabel}
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {HAIRSTYLES.map((hs) => (
                  <button
                    key={hs.id}
                    type="button"
                    onClick={() => {
                      const updated = { ...currentApp, hairstyle: hs.id };
                      handleAnswerChange("appearance", updated);
                      updateAvatarAppearance(updated);
                    }}
                    className={`p-1.5 rounded-lg border text-[10px] font-medium truncate text-center transition-all ${
                      currentApp.hairstyle === hs.id
                        ? "border-vi bg-vi/20 text-tx"
                        : "border-line bg-s2/40 text-mu hover:border-line/80"
                    }`}
                  >
                    {(dict.avatar as any)[hs.id] || hs.id}
                  </button>
                ))}
              </div>
            </div>

            {/* Outfit Style in Compact Grid */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-mu block">
                {dict.avatar.outfitLabel}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {OUTFITS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      const updated = { ...currentApp, outfit: o.id };
                      handleAnswerChange("appearance", updated);
                      updateAvatarAppearance(updated);
                    }}
                    className={`p-2 rounded-lg border text-[11px] font-medium flex items-center justify-between transition-all ${
                      currentApp.outfit === o.id
                        ? "border-vi bg-vi/20 text-tx"
                        : "border-line bg-s2/40 text-mu hover:border-line/80"
                    }`}
                  >
                    <span className="truncate">{(dict.avatar as any)[o.id] || o.id}</span>
                    <div className="flex items-center gap-1 flex-none ml-1">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.topColor }} />
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.bottomColor }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (currentQuestion.type === "single") {
      const selectedValue = answers[currentQuestion.id];
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-w-xl mx-auto">
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
                onClick={() => handleSingleSelect(currentQuestion.id, opt.id)}
                className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between text-left transition-all ${
                  isSelected
                    ? "border-vi bg-vi/20 text-tx shadow-md shadow-vi/10"
                    : "border-line bg-s2/60 text-mu hover:border-vi/50 hover:bg-s2"
                }`}
              >
                <span>{label}</span>
                {isSelected && <Check size={16} className="text-vi flex-none" />}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-w-xl mx-auto">
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
                onClick={() => handleMultiToggle(currentQuestion.id, opt.id)}
                className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between text-left transition-all ${
                  isSelected
                    ? "border-vi bg-vi/20 text-tx shadow-md shadow-vi/10"
                    : "border-line bg-s2/60 text-mu hover:border-vi/50 hover:bg-s2"
                }`}
              >
                <span>{label}</span>
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    isSelected ? "border-vi bg-vi text-white" : "border-line"
                  }`}
                >
                  {isSelected && "✓"}
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
        <div className="space-y-4 max-w-xl mx-auto">
          {currentOptions.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
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
                    onClick={() => handleMultiToggle(currentQuestion.id, opt.id)}
                    className={`chip cursor-pointer py-2 px-3 text-xs transition-all ${
                      isSelected
                        ? "border-vi bg-vi/20 text-tx font-bold"
                        : "border-line bg-s2/60 text-mu hover:border-vi/50"
                    }`}
                  >
                    <span>{label}</span>
                    {isSelected && <span className="ml-1 text-vi">✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Custom Add Input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customInputText}
              onChange={(e) => setCustomInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomOption(currentQuestion.id);
                }
              }}
              placeholder={placeholder}
              className="flex-1 bg-s2 border border-line rounded-xl p-3 text-xs text-tx focus:outline-none focus:border-vi"
            />
            <button
              type="button"
              onClick={() => handleAddCustomOption(currentQuestion.id)}
              className="btn text-xs py-3 px-4"
            >
              {dict.awakening.addBtn}
            </button>
          </div>

          {/* Display Custom Added Items */}
          {selectedList.filter((item) => !currentOptions.some((o) => o.id === item)).length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {selectedList
                .filter((item) => !currentOptions.some((o) => o.id === item))
                .map((item) => (
                  <span
                    key={item}
                    className="chip bg-vi/20 border-vi text-tx py-1.5 px-3 text-xs flex items-center gap-1.5"
                  >
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomOption(currentQuestion.id, item)}
                      className="text-mu hover:text-tx text-xs font-bold"
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
        <div className="space-y-2 max-w-md mx-auto text-left">
          <textarea
            value={textVal}
            onChange={(e) =>
              handleAnswerChange(currentQuestion.id, e.target.value.slice(0, maxLen))
            }
            placeholder={placeholder}
            rows={4}
            className="w-full bg-s2 border border-line rounded-xl p-3 text-xs text-tx focus:outline-none focus:border-vi resize-none"
            maxLength={maxLen}
          />
          <div className="text-right text-[10px] text-mu">
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
        if (e.key === "Enter" && canGoNext) {
          e.preventDefault();
          handleNextSubStep();
        }
      }}
    >
      {/* Canvas Starfield Background */}
      <Starfield />

      {/* Single Compact Header Row (~56px high) */}
      <header className="relative z-20 h-[56px] flex items-center justify-between px-4 md:px-8 border-b border-line/40 bg-ink/70 backdrop-blur-md flex-none gap-4">
        {/* Logo */}
        <Link href="/" className="font-serif text-lg font-bold tracking-wider text-tx hover:opacity-80 flex-none">
          AYRA
        </Link>

        {/* Center Progress Bar & Counter */}
        <div className="flex-1 max-w-lg mx-auto flex items-center gap-3">
          <div className="flex-1 grid grid-cols-5 gap-1.5 items-center">
            {[1, 2, 3, 4, 5].map((st) => {
              const isPast = st < step;
              const isCurrent = st === step;

              let barClass = "bg-white/10";
              if (isPast) barClass = "bg-vi";
              if (isCurrent) barClass = "bg-gradient-to-r from-vi to-go";

              return (
                <div key={st} className="flex flex-col items-center">
                  <div className={`h-1.5 w-full rounded-full transition-all ${barClass}`} />
                  <div
                    className={`text-[10px] truncate hidden md:block mt-0.5 ${
                      isCurrent ? "text-tx font-bold" : "text-mu"
                    }`}
                  >
                    {(dict.awakening.stepNames as any)[`step${st}`]}
                  </div>
                </div>
              );
            })}
          </div>

          {step <= 4 && (
            <div className="text-[10px] text-mu font-medium flex-none hidden sm:block">
              {formatString(dict.awakening.questionProgress, {
                step: formatNumber(lang, step),
                subStep: formatNumber(lang, subStep + 1),
                totalSubSteps: formatNumber(lang, questionsForStep.length),
              })}
            </div>
          )}
        </div>

        {/* Language Switcher & Edit Mode Exit */}
        <div className="flex items-center gap-2 flex-none">
          <div className="flex items-center gap-1 bg-s2/80 p-0.5 rounded-lg border border-line">
            <button
              type="button"
              onClick={() => setLanguage("ru")}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                lang === "ru" ? "bg-vi text-white" : "text-mu hover:text-tx"
              }`}
            >
              RU
            </button>
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
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
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 flex flex-col justify-center items-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-full max-w-2xl mx-auto text-center space-y-4">
          {step <= 4 && currentQuestion && (
            <div className="space-y-1">
              {/* Question Sub-step Counter on mobile */}
              <div className="text-[11px] text-mu font-medium sm:hidden">
                {formatString(dict.awakening.questionProgress, {
                  step: formatNumber(lang, step),
                  subStep: formatNumber(lang, subStep + 1),
                  totalSubSteps: formatNumber(lang, questionsForStep.length),
                })}
              </div>

              {/* Title <h1> or <h2> */}
              <h1
                ref={titleRef}
                tabIndex={-1}
                className="font-serif text-xl md:text-3xl font-bold text-tx focus:outline-none"
              >
                {questionTitle}
              </h1>
            </div>
          )}

          {/* Question Input / Component */}
          <div className="pt-2">{renderQuestionInput()}</div>
        </div>
      </main>

      {/* Bottom Action Footer */}
      {step <= 4 && (
        <footer className="relative z-20 p-3 md:px-8 border-t border-line/40 bg-ink/80 backdrop-blur-md flex-none">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            {/* Left: Back Button */}
            <button
              type="button"
              onClick={handlePrevSubStep}
              disabled={step === 1 && subStep === 0}
              className="btn-ghost text-xs py-2 px-3.5 flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowLeft size={15} />
              <span>{dict.awakening.back}</span>
            </button>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              {/* Step 2 or Step 4: Skip step entirely */}
              {(step === 2 || step === 4) && (
                <button
                  type="button"
                  onClick={handleSkipEntireStep}
                  className="btn-ghost text-xs py-2 px-3 flex items-center gap-1.5 text-mu hover:text-tx"
                >
                  <SkipForward size={14} />
                  <span className="hidden sm:inline">
                    {dict.awakening.skipEntireStep}
                  </span>
                </button>
              )}

              {/* Step 3: Skip optional questions (available after 3 mandatory questions) */}
              {step === 3 && subStep >= 3 && (
                <button
                  type="button"
                  onClick={handleSkipOptionalInStep3}
                  className="btn-ghost text-xs py-2 px-3 flex items-center gap-1.5 text-mu hover:text-tx"
                >
                  <SkipForward size={14} />
                  <span className="hidden sm:inline">
                    {dict.awakening.skipOptionalQuestions}
                  </span>
                </button>
              )}

              {/* Optional question skip */}
              {currentQuestion && !currentQuestion.mandatory && !hasAnsweredCurrent && (
                <button
                  type="button"
                  onClick={handleSkipSubStep}
                  className="btn-ghost text-xs py-2 px-3.5 text-mu hover:text-tx"
                >
                  {dict.awakening.skipQuestion}
                </button>
              )}

              {/* Continue / Next Button */}
              <button
                type="button"
                onClick={handleNextSubStep}
                disabled={!canGoNext}
                className="btn text-xs py-2 px-4 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>{dict.awakening.continue}</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
