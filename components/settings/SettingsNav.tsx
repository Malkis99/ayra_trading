"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Cloud, Monitor, ShieldCheck, User, UserCog, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { formatString } from "@/lib/i18n";
import { SETTINGS_SECTIONS, settingsHref, type SettingsSection } from "@/lib/settings/sections";
import { cn } from "@/components/ui/cn";

export const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  profile: User,
  journal: BookOpen,
  cloud: Cloud,
  account: UserCog,
  interface: Monitor,
  privacy: ShieldCheck,
};

/** Desktop: the menu on the left of the settings page. */
export function SettingsMenu({ active }: { active: SettingsSection }) {
  const { dict } = useApp();
  const t = dict.settings.sections;
  return (
    <nav aria-label={t.menuLabel} className="space-y-1" data-testid="settings-menu">
      {SETTINGS_SECTIONS.map((s) => {
        const Icon = SECTION_ICONS[s];
        const current = s === active;
        return (
          <Link
            key={s}
            href={settingsHref(s)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
              current ? "bg-pri/30 font-semibold text-tx" : "text-mu hover:bg-s2/60 hover:text-tx"
            )}
          >
            <Icon size={16} className={current ? "text-vi" : undefined} aria-hidden />
            <span>{t[s].title}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Relative time like «2 minutes ago» in the interface language. */
function relativeTime(iso: string, lang: string): string {
  const diffSec = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(0, "minute");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

/** Phone: the list of sections with one status line each; a tap opens the section screen. */
export function SettingsSectionList() {
  const { dict, lang } = useApp();
  const t = dict.settings.sections;
  const { user } = useAuth();
  const { gameState } = useGame();
  const { cloudActive, syncMode, cloudStatus, preferences } = useJournal();

  const status: Record<SettingsSection, string> = {
    profile: gameState.name || t.profile.description,
    journal: [
      formatString(t.status.unit, { unit: dict.journalSettings.units[preferences.defaultUnit ?? "R"] }),
      preferences.defaultSession ? dict.journal.sessions[preferences.defaultSession] : null,
    ]
      .filter(Boolean)
      .join(" · "),
    cloud: !cloudActive
      ? t.status.cloudOff
      : [syncMode === "manual" ? t.status.cloudManual : t.status.cloudAuto, cloudStatus.lastSyncAt ? formatString(t.status.lastSync, { time: relativeTime(cloudStatus.lastSyncAt, lang) }) : null]
          .filter(Boolean)
          .join(" · "),
    account: !user ? t.status.signedOut : user.hasPassword ? t.status.passwordSet : t.status.passwordNotSet,
    interface: lang === "ru" ? dict.settings.languageRu : dict.settings.languageEn,
    privacy: gameState.aiConsent ? t.status.aiOn : t.status.aiOff,
  };

  return (
    <nav aria-label={t.menuLabel} data-testid="settings-list">
      <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-s1/60">
        {SETTINGS_SECTIONS.map((s) => {
          const Icon = SECTION_ICONS[s];
          return (
            <li key={s}>
              <Link
                href={settingsHref(s)}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-s2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi"
                data-testid={`settings-list-${s}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pri/25 text-vi">
                  <Icon size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-tx">{t[s].title}</span>
                  <span className="block truncate text-xs text-mu">{status[s]}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-mu" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
