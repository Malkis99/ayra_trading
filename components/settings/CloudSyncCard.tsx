"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Cloud, Database, LogIn, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { useJournal } from "@/lib/journal/context";
import { cloudNoticeState } from "@/lib/journal/cloud/account-notice";
import { formatString } from "@/lib/i18n";
import { Segmented } from "@/components/ui/forms";
import { SettingRow } from "@/components/ui/SettingRow";
import { Button } from "@/components/ui";
import { InitialSyncButton } from "@/components/journal/InitialSyncDialog";

/**
 * «Cloud and data» → the cloud part: where the journal lives now, the Automatic / Manual switch (this device only)
 * and «Synchronise». Guests and accounts without the cloud see where their data is and, for guests, «Sign in».
 */
export function CloudSyncCard() {
  const { dict, lang } = useApp();
  const t = dict.journalSettings;
  const s = dict.settings.sections;
  const { user } = useAuth();
  const { cloudActive, syncMode, setSyncMode, syncNow, cloudStatus, initialSync, syncConflicts, requestConflictDialog } = useJournal();
  const [syncing, setSyncing] = useState(false);

  const notice = user
    ? cloudNoticeState({ cloudActive, initialNeeded: initialSync.needed, pending: cloudStatus.pending, conflicts: cloudStatus.conflicts })
    : null;
  const lastSync = cloudStatus.lastSyncAt
    ? formatString(dict.journal.syncBadge.lastSync, {
        time: new Date(cloudStatus.lastSyncAt).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" }),
      })
    : dict.journal.syncBadge.never;

  return (
    <div className="card space-y-4" data-testid="cloud-settings">
      <h4 className="h4 flex items-center gap-2">
        <Cloud size={18} className="text-vi" aria-hidden="true" />
        <span>{s.cloudStatusTitle}</span>
      </h4>

      <div
        className="flex items-center gap-2 rounded-xl border border-line/60 bg-s1/60 p-3 text-xs text-mu"
        data-testid="account-data-notice"
        data-state={notice ?? "local"}
      >
        {notice ? <Cloud size={14} className="shrink-0 text-vi" aria-hidden="true" /> : <Database size={14} className="shrink-0 text-vi" aria-hidden="true" />}
        <span>{notice ? dict.account.cloudNotice[notice] : dict.account.localDataNotice}</span>
      </div>

      {!user && (
        <Link href="/login" className="btn inline-flex items-center gap-1.5 px-3.5 py-2 text-xs">
          <LogIn size={14} aria-hidden="true" />
          <span>{dict.account.signInToCloudBtn}</span>
        </Link>
      )}

      {cloudActive && (
        <div className="space-y-4 rounded-xl border border-line bg-s2/40 p-3.5">
          <div id="mode" className="scroll-mt-24">
            <SettingRow title={t.cloudModeTitle} hint={t.cloudModeHint} hintLabel={t.hintLabel} data-testid="cloud-sync-mode">
              <Segmented<"auto" | "manual">
                name="cloud-sync-mode"
                options={[
                  { value: "auto", label: t.cloudModeAuto },
                  { value: "manual", label: t.cloudModeManual },
                ]}
                value={syncMode}
                onChange={setSyncMode}
              />
              <p className="text-[11px] text-mu">{t.cloudModeDeviceNote}</p>
            </SettingRow>
          </div>

          <dl className="space-y-0.5 text-xs text-tx/80" data-testid="cloud-sync-status">
            <div>{lastSync}</div>
            <div data-testid="cloud-sync-pending">{cloudStatus.pending > 0 ? formatString(t.syncNowPending, { count: cloudStatus.pending }) : t.syncNowNothing}</div>
            {syncConflicts.length > 0 && <div>{formatString(dict.journal.syncBadge.labels.conflict, { count: syncConflicts.length })}</div>}
          </dl>
          {(cloudStatus.noSpace ?? 0) > 0 && (
            <p className="text-xs text-amber-300" data-testid="cloud-sync-no-space">
              {t.syncNoSpace}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {initialSync.needed ? (
              <InitialSyncButton />
            ) : (
              syncMode === "manual" && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={syncing}
                  onClick={async () => {
                    setSyncing(true);
                    await syncNow();
                    setSyncing(false);
                  }}
                  data-testid="cloud-sync-now"
                >
                  <RefreshCw size={14} className={syncing ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
                  <span>{t.syncNowBtn}</span>
                </Button>
              )
            )}
            {syncConflicts.length > 0 && (
              <Button variant="secondary" size="sm" onClick={requestConflictDialog}>
                {dict.journal.syncBadge.actions.resolve}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
