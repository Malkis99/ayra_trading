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
import { ArrowLeft, ArrowRight, SkipForward, Check, Globe, Sparkles } from "lucide-react";
import { formatString, formatNumber } from "@/lib/i18n";

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
    // Step 3 optional sub-steps are 3, 4, 5, 6. Skip directly to Step 4!
    setStep(4);
    setSubStep(0);
  };

  const handleFinishOnboarding = () => {
    completeOnboarding();
    if (isEditMode) {
      router.push("/settings");
    } else {
      router.push("/");
    }
  };

  const renderQuestionInput = () => {
    if (step === 5) {
      return (
        <div className="text-center space-y-6 py-6 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-vi/20 border border-vi/50 text-vi flex items-center justify-center mx-auto shadow-lg shadow-vi/20 animate-bounce">
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
        <div className="space-y-4 max-w-md mx-auto">
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
        <div className="space-y-5 max-w-md mx-auto text-left">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-mu block">
              {dict.awakening.q.lang_tz.languageLabel}
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
              {dict.awakening.q.lang_tz.timezoneLabel}
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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center max-w-2xl mx-auto">
          {/* Figure Preview Card */}
          <div className="md:col-span-5 flex flex-col items-center justify-center p-4 rounded-2xl bg-s2/80 border border-line">
            <div className="relative w-36 h-48 rounded-xl grid place-items-center bg-radial-gradient from-pri/50 via-s1 to-s1 overflow-hidden border border-vi/30">
              <Figure
                appearance={currentApp}
                width={90}
                height={150}
                rotateSlowly
              />
            </div>
          </div>

          {/* Preset Selectors */}
          <div className="md:col-span-7 space-y-4 text-left">
            {/* Skin Tone */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-mu">
                {dict.avatar.skinToneLabel}
              </label>
              <div className="flex flex-wrap gap-2">
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
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${
                      currentApp.skinTone === st.id
                        ? "border-vi scale-110 ring-2 ring-vi/40"
                        : "border-transparent opacity-80 hover:opacity-100"
                    }`}
                    aria-label={(dict.avatar as any)[st.id] || st.id}
                  />
                ))}
              </div>
            </div>

            {/* Hairstyles */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-mu">
                {dict.avatar.hairstyleLabel}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {HAIRSTYLES.map((hs) => (
                  <button
                    key={hs.id}
                    type="button"
                    onClick={() => {
                      const updated = { ...currentApp, hairstyle: hs.id };
                      handleAnswerChange("appearance", updated);
                      updateAvatarAppearance(updated);
                    }}
                    className={`p-2 rounded-lg border text-[11px] font-medium transition-all ${
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

            {/* Hair Color */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-mu">
                {dict.avatar.hairColorLabel}
              </label>
              <div className="flex flex-wrap gap-2">
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

            {/* Outfit Style */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-mu">
                {dict.avatar.outfitLabel}
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {OUTFITS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      const updated = { ...currentApp, outfit: o.id };
                      handleAnswerChange("appearance", updated);
                      updateAvatarAppearance(updated);
                    }}
                    className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-between transition-all ${
                      currentApp.outfit === o.id
                        ? "border-vi bg-vi/20 text-tx"
                        : "border-line bg-s2/40 text-mu hover:border-line/80"
                    }`}
                  >
                    <span>{(dict.avatar as any)[o.id] || o.id}</span>
                    <div className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: o.topColor }} />
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: o.bottomColor }} />
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

  const questionExplanation =
    currentQuestion && (dict.awakening.q as any)[currentQuestion.id]?.exp
      ? (dict.awakening.q as any)[currentQuestion.id].exp
      : "";

  const hasAnsweredCurrent = useMemo(() => {
    if (!currentQuestion) return false;
    const val = answers[currentQuestion.id];
    if (Array.isArray(val)) return val.length > 0;
    return typeof val === "string" ? val.trim().length > 0 : !!val;
  }, [currentQuestion, answers]);

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col bg-ink text-tx relative z-0 select-none"
      onKeyDown={(e) => {
        if (e.key === "Enter" && canGoNext) {
          e.preventDefault();
          handleNextSubStep();
        }
      }}
    >
      {/* Canvas Starfield Background */}
      <Starfield />

      {/* Top Header Bar */}
      <header className="relative z-20 flex items-center justify-between p-4 md:px-8 border-b border-line/40 bg-ink/60 backdrop-blur-md flex-none">
        <Link href="/" className="font-serif text-xl font-bold tracking-wider text-tx hover:opacity-80">
          AYRA
        </Link>

        <div className="flex items-center gap-3">
          {/* Language Switcher */}
          <div className="flex items-center gap-1 bg-s2/80 p-1 rounded-lg border border-line">
            <button
              onClick={() => setLanguage("ru")}
              className={`text-[11px] font-bold px-2 py-0.5 rounded transition-colors ${
                lang === "ru" ? "bg-vi text-white" : "text-mu hover:text-tx"
              }`}
            >
              RU
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`text-[11px] font-bold px-2 py-0.5 rounded transition-colors ${
                lang === "en" ? "bg-vi text-white" : "text-mu hover:text-tx"
              }`}
            >
              EN
            </button>
          </div>

          {/* Edit Mode Return Button */}
          {isEditMode && (
            <Link
              href="/settings"
              className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <span>{dict.awakening.returnToSettingsBtn}</span>
            </Link>
          )}
        </div>
      </header>

      {/* Top 5-Step Progress Bar */}
      <div className="relative z-20 p-4 md:px-8 bg-s1/40 border-b border-line/20 flex-none">
        <div className="max-w-xl mx-auto space-y-2">
          <div className="grid grid-cols-5 gap-1.5">
            {[1, 2, 3, 4, 5].map((st) => {
              const isPast = st < step;
              const isCurrent = st === step;

              let barClass = "bg-white/10";
              if (isPast) barClass = "bg-vi";
              if (isCurrent) barClass = "bg-gradient-to-r from-vi to-go";

              return (
                <div key={st} className="space-y-1">
                  <div className={`h-1.5 rounded-full transition-all ${barClass}`} />
                  <div
                    className={`text-[10px] truncate text-center hidden md:block ${
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
            <div className="text-[11px] text-mu text-center font-medium">
              {formatString(dict.awakening.questionProgress, {
                step: formatNumber(lang, step),
                subStep: formatNumber(lang, subStep + 1),
                totalSubSteps: formatNumber(lang, questionsForStep.length),
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main Center Area: Question Slide */}
      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-8 flex flex-col justify-center items-center">
        <div className="w-full max-w-2xl mx-auto text-center space-y-6">
          {step <= 4 && currentQuestion && (
            <div className="space-y-2">
              <h1
                ref={titleRef}
                tabIndex={-1}
                className="font-serif text-xl md:text-3xl font-bold text-tx focus:outline-none"
              >
                {questionTitle}
              </h1>

              {questionExplanation && (
                <div className="text-xs text-mu space-y-1">
                  <div>
                    <span className="font-semibold text-tx/80">
                      {dict.awakening.whyThisIsNeeded}:{" "}
                    </span>
                    <span>{questionExplanation}</span>
                  </div>
                  <div className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-white/5 border border-line text-[10px] font-semibold text-mu">
                    🔒 {dict.awakening.visibleOnlyToYou}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Question Component */}
          <div className="pt-2">{renderQuestionInput()}</div>
        </div>
      </main>

      {/* Bottom Actions Bar */}
      {step <= 4 && (
        <footer className="relative z-20 p-4 md:px-8 border-t border-line/40 bg-ink/80 backdrop-blur-md flex-none">
          <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
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
