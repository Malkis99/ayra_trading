"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { AppStorage } from "@/lib/storage";
import { JOURNAL_UNITS, initialUnit } from "@/lib/journal/preferences";
import { SESSIONS_CATALOG, type JournalUnit, type TradeSession } from "@/lib/journal/types";
import { markSetupSeen, readSetupSeen, setupWindowMode, setupWindowSuppressedForTests } from "@/lib/journal/setup-window";
import { journalBackupFileName, journalBackupJson } from "@/lib/journal/export";
import { listImportBatches } from "@/lib/journal/import/batches";
import { settingsHref } from "@/lib/settings/sections";
import { Button, Modal } from "@/components/ui";
import { Segmented, Select } from "@/components/ui/forms";
import { SettingRow } from "@/components/ui/SettingRow";
import { TimezoneSelect } from "@/components/TimezoneSelect";

const LAST_USED = "__last_used__";
const NO_SESSION = "__none__";

function download(fileName: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * First-run setup of the Journal (docs/journal-setup-plan.md): the same settings as «Settings → Journal» and
 * «Cloud and data», with the same «?» hints. Shown once per account on this device by the rules of setup-window.ts.
 * «Save» applies the answers; with «Automatic» and a journal not in the cloud yet, the upload starts at once (with
 * progress and «Cancel»). «Skip» changes nothing. Never over an open conflict or upload window.
 */
export function JournalSetupWindow() {
  const { dict } = useApp();
  const t = dict.journalSetup;
  const s = dict.journalSettings;
  const { user } = useAuth();
  const { gameState, updateTimezone } = useGame();
  const {
    accounts,
    trades,
    preferences,
    setPreferences,
    cloudActive,
    cloudFlagKnown,
    syncMode,
    setSyncMode,
    initialSync,
    initialSyncOpen,
    openInitialSync,
    syncConflicts,
    getAllRecords,
  } = useJournal();

  const [seen, setSeen] = useState(true);
  useEffect(() => {
    setSeen(user ? readSetupSeen(user.id) : true);
  }, [user]);

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archivedAt), [accounts]);
  const mode = setupWindowMode({
    signedIn: Boolean(user),
    seen,
    cloudFlagKnown,
    cloudActive,
    journalEmpty: activeAccounts.length === 0 && trades.length === 0,
    preferencesSet: Object.keys(preferences).length > 0,
  });
  const blocked = initialSyncOpen || syncConflicts.length > 0 || setupWindowSuppressedForTests();

  // Draft answers: the current values (existing users see what they use now)
  const [unit, setUnit] = useState<JournalUnit>("R");
  const [mainAccount, setMainAccount] = useState<string>(LAST_USED);
  const [session, setSession] = useState<string>(NO_SESSION);
  const [timezone, setTimezone] = useState<string>("");
  const [cloudMode, setCloudMode] = useState<"auto" | "manual">("auto");
  const open = Boolean(mode) && !blocked;
  useEffect(() => {
    if (!open) return;
    setUnit(initialUnit(preferences, AppStorage.getItem("ayra_journal_unit")));
    setMainAccount(preferences.mainAccountId && activeAccounts.some((a) => a.id === preferences.mainAccountId) ? preferences.mainAccountId : LAST_USED);
    setSession(preferences.defaultSession ?? NO_SESSION);
    setTimezone(gameState.profile.timezone);
    setCloudMode(syncMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !user) return null;

  const finish = () => {
    markSetupSeen(user.id);
    setSeen(true);
  };

  const save = () => {
    if (mode === "full") {
      setPreferences({
        ...preferences,
        defaultUnit: unit,
        mainAccountId: mainAccount === LAST_USED ? null : mainAccount,
        defaultSession: session === NO_SESSION ? null : (session as TradeSession),
      });
      if (timezone && timezone !== gameState.profile.timezone) updateTimezone(timezone);
    }
    if (cloudActive) setSyncMode(cloudMode);
    finish();
    // «Automatic» and the journal of this device is not in the cloud yet: upload now
    if (cloudActive && cloudMode === "auto" && initialSync.needed) openInitialSync({ autoStart: true });
  };

  const backup = () => download(journalBackupFileName(), journalBackupJson(getAllRecords(), listImportBatches()));

  return (
    <Modal
      isOpen
      onClose={finish}
      title={t.title}
      subtitle={mode === "cloudOnly" ? t.subtitleCloudOnly : t.subtitle}
      closeLabel={t.close}
      size="md"
      sheetOnMobile
      data-testid="journal-setup"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={finish} data-testid="journal-setup-skip">
            {t.skip}
          </Button>
          <Button onClick={save} data-testid="journal-setup-save">
            {t.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {cloudActive && (
          <SettingRow title={s.cloudModeTitle} hint={s.cloudModeHint} hintLabel={s.hintLabel} data-testid="journal-setup-cloud">
            <Segmented<"auto" | "manual">
              name="journal-setup-cloud"
              options={[
                { value: "auto", label: s.cloudModeAuto },
                { value: "manual", label: s.cloudModeManual },
              ]}
              value={cloudMode}
              onChange={setCloudMode}
            />
            <p className="text-[11px] text-mu">{s.cloudModeDeviceNote}</p>
            {initialSync.needed && (
              <div className="space-y-2 rounded-xl border border-line bg-s2/40 p-3 text-xs">
                <p className="text-tx/90" data-testid="journal-setup-upload-note">
                  {cloudMode === "auto" ? t.uploadAuto : t.uploadManual}
                </p>
                <p className="text-mu">{dict.journal.initialSync.backup}</p>
                <Button variant="secondary" size="sm" onClick={backup} data-testid="journal-setup-backup">
                  <Download size={14} aria-hidden="true" />
                  {dict.journal.initialSync.backupButton}
                </Button>
              </div>
            )}
          </SettingRow>
        )}

        {mode === "full" && (
          <>
            <SettingRow title={s.unitTitle} hint={s.unitHint} hintLabel={s.hintLabel} data-testid="journal-setup-unit">
              <Segmented<JournalUnit> name="journal-setup-unit" options={JOURNAL_UNITS.map((u) => ({ value: u, label: s.units[u] }))} value={unit} onChange={setUnit} />
            </SettingRow>

            {/* With one account there is nothing to choose */}
            {activeAccounts.length > 1 && (
              <SettingRow title={s.mainAccountTitle} hint={s.mainAccountHint} hintLabel={s.hintLabel} data-testid="journal-setup-account">
                <Select<string>
                  aria-label={s.mainAccountTitle}
                  options={[{ value: LAST_USED, label: s.mainAccountLastUsed }, ...activeAccounts.map((a) => ({ value: a.id, label: a.name || a.id }))]}
                  value={mainAccount}
                  onChange={setMainAccount}
                  data-testid="journal-setup-account-select"
                />
              </SettingRow>
            )}

            <SettingRow title={s.timezoneTitle} hint={s.timezoneHint} hintLabel={s.hintLabel} data-testid="journal-setup-timezone">
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </SettingRow>

            <SettingRow title={s.sessionTitle} hint={s.sessionHint} hintLabel={s.hintLabel} data-testid="journal-setup-session">
              <Select<string>
                aria-label={s.sessionTitle}
                options={[{ value: NO_SESSION, label: s.sessionNone }, ...SESSIONS_CATALOG.map((x) => ({ value: x as string, label: dict.journal.sessions[x] }))]}
                value={session}
                onChange={setSession}
                data-testid="journal-setup-session-select"
              />
            </SettingRow>
          </>
        )}

        <p className="text-[11px] text-mu">
          {t.later}{" "}
          <Link href={settingsHref("journal")} className="text-vi hover:underline">
            {dict.settings.sections.journal.title}
          </Link>
          {cloudActive && (
            <>
              {" · "}
              <Link href={settingsHref("cloud")} className="text-vi hover:underline">
                {dict.settings.sections.cloud.title}
              </Link>
            </>
          )}
        </p>
      </div>
    </Modal>
  );
}
