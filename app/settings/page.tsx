"use client";

import React from "react";
import { useApp } from "@/lib/context";

export default function SettingsPage() {
  const { dict, lang, setLanguage } = useApp();

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.settings.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.settings.subtitle}</p>
      </div>

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
