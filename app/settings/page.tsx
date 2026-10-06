"use client";

import React from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Sparkles, Shield, Compass } from "lucide-react";

export default function SettingsPage() {
  const { dict, lang, setLanguage } = useApp();
  const { gameState, setAiConsent } = useGame();

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.settings.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.settings.subtitle}</p>
      </div>

      {/* Onboarding & Personalization Card */}
      <div className="card space-y-4">
        <h4 className="h4 flex items-center gap-2">
          <Compass size={18} className="text-vi" />
          <span>{dict.settings.onboardingSectionTitle}</span>
        </h4>

        {/* Link to /awakening?mode=edit */}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-tx">
              {dict.settings.editAnswersBtn}
            </div>
          </div>
          <Link
            href="/awakening?mode=edit"
            className="btn text-xs py-2 px-3.5 inline-flex items-center justify-center gap-1.5 self-start sm:self-auto"
          >
            <span>{dict.settings.editAnswersBtn}</span>
          </Link>
        </div>

        {/* AI Consent Checkbox */}
        <div className="rounded-xl border border-line bg-s2/40 p-3.5 space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={gameState.aiConsent}
              onChange={(e) => setAiConsent(e.target.checked)}
              className="mt-0.5 rounded border-line bg-s1 text-vi focus:ring-vi cursor-pointer"
            />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-tx flex items-center gap-1.5">
                <Sparkles size={14} className="text-go" />
                <span>{dict.settings.aiConsentLabel}</span>
              </div>
              <p className="text-[11px] text-mu">
                {dict.settings.aiConsentDesc}
              </p>
            </div>
          </label>
        </div>

        {/* Minor Mode Badge / Restrictions */}
        {gameState.profile.minorMode && (
          <div className="rounded-xl border border-go/40 bg-go/10 p-3.5 space-y-1 text-xs">
            <div className="font-semibold text-go flex items-center gap-1.5">
              <Shield size={14} />
              <span>{dict.settings.minorModeBadge}</span>
            </div>
            <p className="text-mu text-[11px]">
              {dict.settings.minorModeInfo}
            </p>
            <p className="text-mu text-[11px] italic pt-1">
              {dict.settings.minorModeCannotDisableInSettings}
            </p>
          </div>
        )}
      </div>

      {/* Interface Settings Card */}
      <div className="card space-y-4">
        <h4 className="h4">{dict.settings.uiParams}</h4>

        {/* Language Switcher */}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-tx">{dict.settings.languageLabel}</div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-s1 p-1 text-xs">
            <button
              type="button"
              onClick={() => setLanguage("ru")}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                lang === "ru"
                  ? "bg-pri text-white shadow-sm"
                  : "text-mu hover:text-tx"
              }`}
            >
              {dict.settings.languageRu}
            </button>
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                lang === "en"
                  ? "bg-pri text-white shadow-sm"
                  : "text-mu hover:text-tx"
              }`}
            >
              {dict.settings.languageEn}
            </button>
          </div>
        </div>

        <div className="text-xs text-mu space-y-2 pt-2">
          <p>{dict.settings.themeInfo}</p>
          <p>{dict.settings.notificationsInfo}</p>
        </div>
      </div>
    </div>
  );
}
