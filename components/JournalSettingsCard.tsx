"use client";

import React, { useMemo, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { AppStorage } from "@/lib/storage";
import { JOURNAL_UNITS, initialUnit } from "@/lib/journal/preferences";
import { SESSIONS_CATALOG, type JournalUnit, type TradeSession } from "@/lib/journal/types";
import { Segmented, Select } from "@/components/ui/forms";
import { SettingRow } from "@/components/ui/SettingRow";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { InitialSyncButton } from "@/components/journal/InitialSyncDialog";
import { Button } from "@/components/ui";
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
  const { preferences, setPreferences, accounts, cloudActive, syncMode, setSyncMode, syncNow, cloudStatus, initialSync } = useJournal();
  const [syncing, setSyncing] = useState(false);
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
        {/* Signed in with the cloud flag on: automatic or manual exchange on this device */}
        {cloudActive && (
          <SettingRow title={t.cloudModeTitle} hint={t.cloudModeHint} hintLabel={t.hintLabel} data-testid="journal-settings-cloud">
            <Segmented<"auto" | "manual">
              name="journal-cloud-mode"
              options={[
                { value: "auto", label: t.cloudModeAuto },
                { value: "manual", label: t.cloudModeManual },
              ]}
              value={syncMode}
              onChange={setSyncMode}
            />
            <p className="text-[11px] text-mu">{t.cloudModeDeviceNote}</p>
            {initialSync.needed ? (
              <InitialSyncButton />
            ) : (
              syncMode === "manual" && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={syncing}
                    onClick={async () => {
                      setSyncing(true);
                      await syncNow();
                      setSyncing(false);
                    }}
                    data-testid="journal-settings-sync-now"
                  >
                    <RefreshCw size={14} className={syncing ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
                    <span>{t.syncNowBtn}</span>
                  </Button>
                  <span className="text-xs text-mu" data-testid="journal-settings-pending">
                    {cloudStatus.pending > 0 ? formatString(t.syncNowPending, { count: cloudStatus.pending }) : t.syncNowNothing}
                  </span>
                </div>
              )
            )}
          </SettingRow>
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
          <p className="text-[11px] text-mu">{t.timezoneLocalNote}</p>
        </SettingRow>
      </div>

      <p className="text-[11px] text-mu">{t.footer}</p>
    </div>
  );
}
