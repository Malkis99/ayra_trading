"use client";

import React from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Sparkles, Shield, Compass, HardDrive, AlertTriangle, User, LogOut, LogIn, Database } from "lucide-react";
import { defaultAttachmentRepository } from "@/lib/journal/attachments/indexeddb-repository";
import { AttachmentStorageEstimate } from "@/lib/journal/attachments/types";

export default function SettingsPage() {
  const { dict, lang, setLanguage } = useApp();
  const { gameState, setAiConsent } = useGame();
  const { user, signOut, isGuest } = useAuth();
  const [storageEstimate, setStorageEstimate] = React.useState<AttachmentStorageEstimate | null>(null);

  React.useEffect(() => {
    defaultAttachmentRepository.getStorageUsage().then(setStorageEstimate).catch(() => {});
  }, []);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.settings.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.settings.subtitle}</p>
      </div>

      {/* Account Section Card */}
      <div className="card space-y-4">
        <h4 className="h4 flex items-center gap-2">
          <User size={18} className="text-vi" />
          <span>{dict.account.title}</span>
        </h4>

        {user ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-s2/40 p-3.5 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                <span className="text-mu">{dict.account.emailLabel}:</span>
                <span className="font-semibold text-tx">{user.email}</span>
              </div>
              {user.created_at && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                  <span className="text-mu">{dict.account.createdAtLabel}:</span>
                  <span className="text-tx">{new Date(user.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US")}</span>
                </div>
              )}
            </div>

            {/* Local Data Storage Info Banner */}
            <div className="flex items-center gap-2 rounded-xl border border-line/60 bg-s1/60 p-3 text-xs text-mu">
              <Database size={14} className="shrink-0 text-vi" />
              <span>{dict.account.localDataNotice}</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                onClick={() => signOut()}
                className="btn-danger text-xs py-2 px-3.5 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut size={14} />
                <span>{dict.account.signOutBtn}</span>
              </button>

              <div className="flex flex-wrap gap-2 text-xs text-mu">
                <span className="rounded-lg border border-line bg-s1 px-2.5 py-1 text-[11px]" title="T7d">
                  {dict.account.deleteAccountSoon}
                </span>
                <span className="rounded-lg border border-line bg-s1 px-2.5 py-1 text-[11px]" title="T7d">
                  {dict.account.deleteDeviceSoon}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-line bg-s2/40 p-3.5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-tx">{dict.account.guestBadge}</span>
                  <span className="rounded-full bg-vi/20 px-2 py-0.5 text-[10px] font-medium text-vi">
                    Local Only
                  </span>
                </div>
                <p className="text-[11px] text-mu">{dict.account.localDataNotice}</p>
              </div>

              <Link
                href="/login"
                className="btn text-xs py-2 px-3.5 inline-flex items-center justify-center gap-1.5 self-start sm:self-auto cursor-pointer"
              >
                <LogIn size={14} />
                <span>{dict.account.signInToCloudBtn}</span>
              </Link>
            </div>
          </div>
        )}
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

      {/* Storage & Attachments Usage Card */}
      <div className="card space-y-4">
        <h4 className="h4 flex items-center gap-2">
          <HardDrive size={18} className="text-acc" />
          <span>{dict.journal.attachments.title}</span>
        </h4>

        {storageEstimate && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold text-tx">
                  {dict.journal.attachments.storageUsage.replace(
                    "{size}",
                    (storageEstimate.bytesUsed / (1024 * 1024)).toFixed(1)
                  )}
                </div>
                <div className="text-[11px] text-mu mt-0.5">
                  {(storageEstimate.bytesQuota / (1024 * 1024)).toFixed(0)} MB total quota
                </div>
              </div>

              <div className="w-full sm:w-36 bg-s1 h-2 rounded-full border border-line overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    storageEstimate.isWarning ? "bg-amber-400" : "bg-acc"
                  }`}
                  style={{ width: `${Math.min(100, storageEstimate.percentage)}%` }}
                />
              </div>
            </div>

            {storageEstimate.isWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1 text-xs text-amber-300">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  <span>Warning</span>
                </div>
                <p className="text-[11px]">
                  {dict.journal.attachments.storageWarning.replace(
                    "{percent}",
                    storageEstimate.percentage.toFixed(0)
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
