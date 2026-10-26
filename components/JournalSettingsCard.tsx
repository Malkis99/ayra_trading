"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { AppStorage } from "@/lib/storage";
import { JOURNAL_UNITS, initialUnit } from "@/lib/journal/preferences";
import { SESSIONS_CATALOG, type JournalUnit, type TradeSession } from "@/lib/journal/types";
import { Segmented, Select } from "@/components/ui/forms";
import { SettingRow } from "@/components/ui/SettingRow";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { settingsHref } from "@/lib/settings/sections";
import { formatString } from "@/lib/i18n";

const LAST_USED = "__last_used__";
const NO_SESSION = "__none__";

/**
 * «Settings → Journal» (docs/journal-setup-plan.md, PR 1): default unit, main account, default session, time zone.
 * Unit, account and session are the account's journal settings (synced with the journal when the cloud is on);
 * the time zone is the profile's one and, for now, stays on this device.
 */
export function JournalSettingsCard() {
  const { dict } = useApp();
  const t = dict.journalSettings;
  const { gameState, updateTimezone } = useGame();
  const { preferences, setPreferences, accounts, cloudActive, syncMode } = useJournal();
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archivedAt), [accounts]);

  // Shown value = what the Journal opens with now (the default, else the last switch on this device)
  const unit = initialUnit(preferences, typeof window !== "undefined" ? AppStorage.getItem("ayra_journal_unit") : null);
  const mainAccount = preferences.mainAccountId && activeAccounts.some((a) => a.id === preferences.mainAccountId) ? preferences.mainAccountId : LAST_USED;
  const session = preferences.defaultSession ?? NO_SESSION;

  const update = (patch: Partial<typeof preferences>) => setPreferences({ ...preferences, ...patch });

  return (
    <div className="card space-y-4" data-testid="journal-settings">
      <div className="space-y-1">
        <h4 className="h4 flex items-center gap-2">
          <BookOpen size={18} className="text-vi" aria-hidden="true" />
          <span>{t.title}</span>
        </h4>
        <p className="text-[11px] text-mu">{t.subtitle}</p>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-s2/40 p-3.5">
        {/* The cloud switch lives in «Cloud and data»; here only where it is set now */}
        {cloudActive && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="journal-settings-cloud-link">
            <span className="text-tx">{formatString(dict.settings.sections.journalCloudRow, { mode: syncMode === "manual" ? t.cloudModeManual : t.cloudModeAuto })}</span>
            <Link href={settingsHref("cloud", "mode")} className="font-semibold text-vi hover:underline">
              {dict.settings.sections.journalCloudChange}
            </Link>
          </div>
        )}

        <SettingRow title={t.unitTitle} hint={t.unitHint} hintLabel={t.hintLabel} data-testid="journal-settings-unit">
          <Segmented<JournalUnit>
            name="journal-default-unit"
            options={JOURNAL_UNITS.map((u) => ({ value: u, label: t.units[u] }))}
            value={unit}
            onChange={(u) => update({ defaultUnit: u })}
          />
        </SettingRow>

        <SettingRow title={t.mainAccountTitle} hint={t.mainAccountHint} hintLabel={t.hintLabel} data-testid="journal-settings-account">
          {activeAccounts.length === 0 ? (
            <p className="text-xs text-mu">{t.mainAccountNone}</p>
          ) : (
            <Select<string>
              aria-label={t.mainAccountTitle}
              options={[{ value: LAST_USED, label: t.mainAccountLastUsed }, ...activeAccounts.map((a) => ({ value: a.id, label: a.name || a.id }))]}
              value={mainAccount}
              onChange={(v) => update({ mainAccountId: v === LAST_USED ? null : v })}
              data-testid="journal-settings-account-select"
            />
          )}
        </SettingRow>

        <SettingRow title={t.sessionTitle} hint={t.sessionHint} hintLabel={t.hintLabel} data-testid="journal-settings-session">
          <Select<string>
            aria-label={t.sessionTitle}
            options={[{ value: NO_SESSION, label: t.sessionNone }, ...SESSIONS_CATALOG.map((s) => ({ value: s as string, label: dict.journal.sessions[s] }))]}
            value={session}
            onChange={(v) => update({ defaultSession: v === NO_SESSION ? null : (v as TradeSession) })}
            data-testid="journal-settings-session-select"
          />
        </SettingRow>

        <SettingRow title={t.timezoneTitle} hint={t.timezoneHint} hintLabel={t.hintLabel} data-testid="journal-settings-timezone">
          <TimezoneSelect value={gameState.profile.timezone} onChange={updateTimezone} />
          <p className="text-[11px] text-mu" data-testid="journal-settings-timezone-note">{cloudActive ? t.timezoneCloudNote : t.timezoneLocalNote}</p>
        </SettingRow>
      </div>

      <p className="text-[11px] text-mu">{t.footer}</p>
    </div>
  );
}
