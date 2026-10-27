"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Compass, FileText, HardDrive, KeyRound, LogIn, LogOut, Shield, Sparkles, User, UserPen } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { defaultAttachmentRepository } from "@/lib/journal/attachments/indexeddb-repository";
import type { AttachmentStorageEstimate } from "@/lib/journal/attachments/types";
import type { SettingsSection } from "@/lib/settings/sections";
import { SetPasswordDialog } from "@/components/SetPasswordDialog";
import { OwnerDiagnosticsBlock } from "@/components/OwnerDiagnosticsBlock";
import { DeviceDataCard } from "@/components/DeviceDataCard";
import { JournalSettingsCard } from "@/components/JournalSettingsCard";
import { CloudSyncCard } from "@/components/settings/CloudSyncCard";
import { ScreenshotsCloudCard } from "@/components/settings/ScreenshotsCloudCard";

/* ------------------------------------------------------------------ Profile */

function ProfileSection() {
  const { dict } = useApp();
  const { gameState } = useGame();
  const t = dict.settings.sections;
  return (
    <div className="card space-y-4">
      <h4 className="h4 flex items-center gap-2">
        <Compass size={18} className="text-vi" aria-hidden="true" />
        <span>{dict.settings.onboardingSectionTitle}</span>
      </h4>
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold text-tx">{dict.settings.editAnswersBtn}</div>
        <Link href="/awakening?mode=edit" className="btn inline-flex items-center justify-center gap-1.5 self-start px-3.5 py-2 text-xs sm:self-auto">
          <span>{dict.settings.editAnswersBtn}</span>
        </Link>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold text-tx">{t.editProfile}</div>
        <Link
          href="/profile?tab=edit"
          className="btn-ghost inline-flex items-center justify-center gap-1.5 self-start border border-line px-3.5 py-2 text-xs sm:self-auto"
        >
          <UserPen size={14} aria-hidden="true" />
          <span>{t.editProfileBtn}</span>
        </Link>
      </div>
      {/* Minor mode: read only, as before */}
      {gameState.profile.minorMode && (
        <div className="space-y-1 rounded-xl border border-go/40 bg-go/10 p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-go">
            <Shield size={14} aria-hidden="true" />
            <span>{dict.settings.minorModeBadge}</span>
          </div>
          <p className="text-[11px] text-mu">{dict.settings.minorModeInfo}</p>
          <p className="pt-1 text-[11px] italic text-mu">{dict.settings.minorModeCannotDisableInSettings}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Account and security */

function AccountSection() {
  const { dict, lang } = useApp();
  const { user, signOut } = useAuth();
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [passwordSaved, setPasswordSaved] = React.useState(false);

  return (
    <div className="card space-y-4">
      <h4 className="h4 flex items-center gap-2">
        <User size={18} className="text-vi" aria-hidden="true" />
        <span>{dict.account.title}</span>
      </h4>

      {user ? (
        <div className="space-y-3">
          <div className="space-y-2 rounded-xl border border-line bg-s2/40 p-3.5">
            <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="text-mu">{dict.account.emailLabel}:</span>
              <span className="font-semibold text-tx">{user.email}</span>
            </div>
            {user.created_at && (
              <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="text-mu">{dict.account.createdAtLabel}:</span>
                <span className="text-tx">{new Date(user.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US")}</span>
              </div>
            )}
          </div>

          <div aria-live="polite">
            {passwordSaved && (
              <p className="rounded-xl border border-vi/40 bg-pri/20 p-3 text-xs text-tx" data-testid="password-saved">
                {dict.account.password.saved}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => signOut()} className="btn-danger inline-flex cursor-pointer items-center gap-1.5 px-3.5 py-2 text-xs">
                <LogOut size={14} aria-hidden="true" />
                <span>{dict.account.signOutBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordSaved(false);
                  setPasswordOpen(true);
                }}
                className="btn-ghost inline-flex cursor-pointer items-center gap-1.5 border border-line px-3.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                data-testid="password-open"
              >
                <KeyRound size={14} aria-hidden="true" />
                <span>{user.hasPassword ? dict.account.password.change : dict.account.password.create}</span>
              </button>
            </div>
            <span className="rounded-lg border border-line bg-s1 px-2.5 py-1 text-[11px] text-mu" title="T7d">
              {dict.account.deleteAccountSoon}
            </span>
          </div>
          <SetPasswordDialog
            isOpen={passwordOpen}
            onClose={() => setPasswordOpen(false)}
            onSaved={() => {
              setPasswordOpen(false);
              setPasswordSaved(true);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-s2/40 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-tx">{dict.account.guestBadge}</span>
              <span className="rounded-full bg-vi/20 px-2 py-0.5 text-[10px] font-medium text-vi">Local Only</span>
            </div>
            <p className="text-[11px] text-mu">{dict.account.localDataNotice}</p>
          </div>
          <Link href="/login" className="btn inline-flex cursor-pointer items-center justify-center gap-1.5 self-start px-3.5 py-2 text-xs sm:self-auto">
            <LogIn size={14} aria-hidden="true" />
            <span>{dict.account.signInToCloudBtn}</span>
          </Link>
        </div>
      )}

      {/* Diagnostics (collapsed, shown to everyone as before; moved here from the interface card) */}
      <OwnerDiagnosticsBlock />
    </div>
  );
}

/* ------------------------------------------------------------------ Cloud and data */

function StorageCard() {
  const { dict } = useApp();
  const [estimate, setEstimate] = React.useState<AttachmentStorageEstimate | null>(null);
  React.useEffect(() => {
    defaultAttachmentRepository.getStorageUsage().then(setEstimate).catch(() => {});
  }, []);
  return (
    <div className="card space-y-4">
      <h4 className="h4 flex items-center gap-2">
        <HardDrive size={18} className="text-acc" aria-hidden="true" />
        <span>{dict.journal.attachments.title}</span>
      </h4>
      {estimate && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold text-tx">{dict.journal.attachments.storageUsage.replace("{size}", (estimate.bytesUsed / (1024 * 1024)).toFixed(1))}</div>
              <div className="mt-0.5 text-[11px] text-mu">{(estimate.bytesQuota / (1024 * 1024)).toFixed(0)} MB total quota</div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full border border-line bg-s1 sm:w-36">
              <div className={`h-full transition-all ${estimate.isWarning ? "bg-amber-400" : "bg-acc"}`} style={{ width: `${Math.min(100, estimate.percentage)}%` }} />
            </div>
          </div>
          {estimate.isWarning && (
            <div className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>Warning</span>
              </div>
              <p className="text-[11px]">{dict.journal.attachments.storageWarning.replace("{percent}", estimate.percentage.toFixed(0))}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CloudSection() {
  return (
    <>
      <CloudSyncCard />
      <ScreenshotsCloudCard />
      <DeviceDataCard />
      <StorageCard />
    </>
  );
}

/* ------------------------------------------------------------------ Interface */

function InterfaceSection() {
  const { dict, lang, setLanguage } = useApp();
  return (
    <div className="card space-y-4">
      <h4 className="h4">{dict.settings.uiParams}</h4>
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-s2/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold text-tx">{dict.settings.languageLabel}</div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-s1 p-1 text-xs">
          {(["ru", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              aria-pressed={lang === l}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${lang === l ? "bg-pri text-white shadow-sm" : "text-mu hover:text-tx"}`}
            >
              {l === "ru" ? dict.settings.languageRu : dict.settings.languageEn}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 pt-2 text-xs text-mu">
        <p>{dict.settings.themeInfo}</p>
        <p>{dict.settings.notificationsInfo}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Privacy */

function PrivacySection() {
  const { dict } = useApp();
  const { gameState, setAiConsent } = useGame();
  return (
    <div className="card space-y-4">
      <h4 className="h4 flex items-center gap-2">
        <Shield size={18} className="text-vi" aria-hidden="true" />
        <span>{dict.settings.sections.privacy.title}</span>
      </h4>
      <div className="space-y-2 rounded-xl border border-line bg-s2/40 p-3.5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={gameState.aiConsent}
            onChange={(e) => setAiConsent(e.target.checked)}
            className="mt-0.5 cursor-pointer rounded border-line bg-s1 text-vi focus:ring-vi"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-tx">
              <Sparkles size={14} className="text-go" aria-hidden="true" />
              <span>{dict.settings.aiConsentLabel}</span>
            </div>
            <p className="text-[11px] text-mu">{dict.settings.aiConsentDesc}</p>
          </div>
        </label>
      </div>
      <div className="space-y-2 rounded-xl border border-line bg-s2/40 p-3.5 text-xs">
        <div className="font-semibold text-tx">{dict.settings.sections.legalTitle}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/legal/terms" className="inline-flex items-center gap-1 text-vi hover:underline">
            <FileText size={13} aria-hidden="true" />
            {dict.legal.termsTitle}
          </Link>
          <Link href="/legal/privacy" className="inline-flex items-center gap-1 text-vi hover:underline">
            <FileText size={13} aria-hidden="true" />
            {dict.legal.privacyTitle}
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SettingsSectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case "profile":
      return <ProfileSection />;
    case "journal":
      return <JournalSettingsCard />;
    case "cloud":
      return <CloudSection />;
    case "account":
      return <AccountSection />;
    case "interface":
      return <InterfaceSection />;
    case "privacy":
      return <PrivacySection />;
  }
}
