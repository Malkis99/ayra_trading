"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone, Download, Copy, Trash2, LogOut, UserRound } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UnsyncedSignOutWarning } from "@/components/UnsyncedSignOutWarning";
import { useJournal } from "@/lib/journal/context";
import { formatNumber, formatString } from "@/lib/i18n";
import { deviceJournalCounts } from "@/lib/journal/device-counts";
import { signOutWarningState } from "@/lib/journal/cloud/account-notice";
import {
  accountHasProgress,
  copyGuestToAccount,
  deleteAccountDeviceData,
  deleteGuestData,
  exportGuestData,
  setProfileChoice,
  summarizeSpace,
  type SpaceSummary,
} from "@/lib/storage/profile-transfer";

type Dialog = null | "deleteGuest" | "signOutDelete" | "unsynced";
type Status = { kind: "ok" | "error"; text: string } | null;

function downloadJson(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeviceDataCard() {
  const { dict, lang } = useApp();
  const t = dict.deviceData;
  const { user, profile, signOut } = useAuth();
  const { readUnsynced, cloudActive, initialSync, accounts, trades, strategies, notes, noTrades, plans, weekPlans } = useJournal();
  const journalCounts = useMemo(
    () => deviceJournalCounts({ accounts, trades, strategies, notes, noTrades, plans, weekPlans }),
    [accounts, trades, strategies, notes, noTrades, plans, weekPlans]
  );
  const kindLabels = dict.journal.initialSync.kinds;
  // Sign out and delete: first warn when changes are not in the cloud yet or conflicts wait (sync on only).
  // The confirmation warning follows the cloud state at the moment it opens (flag off: the old text).
  const [signOutWarning, setSignOutWarning] = useState<string | null>(null);
  const openSignOutConfirm = () => {
    const u = readUnsynced();
    const s = signOutWarningState({ cloudActive, initialNeeded: initialSync.needed, pending: u.pending, conflicts: u.conflicts });
    setSignOutWarning(s ? t.signOutDeleteWarningCloud[s] : null);
    setDialog("signOutDelete");
  };
  const startSignOutDelete = () => {
    const u = readUnsynced();
    if (u.pending > 0 || u.conflicts > 0) return setDialog("unsynced");
    openSignOutConfirm();
  };

  const [guest, setGuest] = useState<SpaceSummary | null>(null);
  const [accountHasData, setAccountHasData] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const refresh = useCallback(() => {
    setGuest(summarizeSpace(null));
    setAccountHasData(user ? accountHasProgress(user.id) : true);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (action: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const okText = await action();
      if (okText) setStatus({ kind: "ok", text: okText });
    } catch {
      setStatus({ kind: "error", text: t.actionError });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleExport = () =>
    run(async () => {
      const data = await exportGuestData();
      downloadJson(`ayra-guest-${data.exportedAt.slice(0, 10)}.json`, data);
      return data.attachmentsCount > 0
        ? `${t.exportDone} ${formatString(t.exportScreenshotsNote, { count: formatNumber(lang, data.attachmentsCount) })}`
        : t.exportDone;
    });

  const handleCopy = () =>
    run(async () => {
      if (!user) return null;
      try {
        await copyGuestToAccount(user.id, { nickname: profile?.nickname });
      } catch {
        setStatus({ kind: "error", text: t.copyError });
        return null;
      }
      setProfileChoice(user.id, "copied");
      return t.copyDone;
    });

  const handleDeleteGuest = () => {
    setDialog(null);
    run(async () => {
      await deleteGuestData();
      return t.deleteGuestDone;
    });
  };

  const handleSignOutDelete = () => {
    setDialog(null);
    if (!user) return;
    const userId = user.id;
    run(async () => {
      await signOut();
      await deleteAccountDeviceData(userId);
      return null;
    });
  };

  const hasGuest = !!guest?.hasData;
  const btnBase =
    "text-xs py-2 px-3.5 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi";

  // Unchanged guest actions; «Copy to account» only on its existing condition (owner: no new buttons)
  const guestButtons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={handleExport} disabled={busy} className={`btn-ghost border border-line ${btnBase}`}>
        <Download size={14} aria-hidden="true" />
        <span>{t.exportBtn}</span>
      </button>

      {user && !accountHasData && (
        <button type="button" onClick={handleCopy} disabled={busy} title={t.copyHint} className={`btn ${btnBase}`}>
          <Copy size={14} aria-hidden="true" />
          <span>{t.copyBtn}</span>
        </button>
      )}

      {user && (
        <button type="button" onClick={() => setDialog("deleteGuest")} disabled={busy} className={`btn-danger ${btnBase}`}>
          <Trash2 size={14} aria-hidden="true" />
          <span>{t.deleteGuestBtn}</span>
        </button>
      )}
    </div>
  );


  return (
    <div className="card space-y-4">
      <div className="space-y-1">
        <h4 className="h4 flex items-center gap-2">
          <Smartphone size={18} className="text-vi" aria-hidden="true" />
          <span>{t.title}</span>
        </h4>
        <p className="text-[11px] text-mu">{user ? t.accountSubtitle : t.subtitle}</p>
      </div>

      {/* Signed in: this account's journal first, then the guest data, clearly apart from the account */}
      {user && (
        <div className="rounded-xl border border-line bg-s2/40 p-3.5 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-mu">{t.journalCounts.title}</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4" data-testid="device-journal-counts">
            {journalCounts.map(({ table, count }) => (
              <div key={table} className="flex items-baseline justify-between gap-2 text-xs" data-kind={table}>
                <dt className="text-mu">{kindLabels[table]}</dt>
                <dd className="font-semibold tabular-nums text-tx">{formatNumber(lang, count)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-mu">{t.journalCounts.hint}</p>
        </div>
      )}

      {user ? (
        <div className="space-y-2 rounded-xl border border-dashed border-line p-3.5" data-testid="guest-block">
          <div className="flex flex-wrap items-center gap-2">
            <UserRound size={14} className="shrink-0 text-mu" aria-hidden="true" />
            <span className="text-xs font-semibold text-tx">{t.guestTitle}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-mu">{t.guestNotLinked}</span>
          </div>
          <p className="text-[11px] text-mu">{t.guestExplain}</p>
          {hasGuest && guest ? (
            <p className="break-all text-xs text-tx/90" data-testid="guest-line">
              {formatString(t.guestLine, {
                name: guest.nickname || "—",
                level: formatNumber(lang, guest.level),
                trades: formatNumber(lang, guest.tradesCount),
              })}
            </p>
          ) : (
            <p className="text-xs text-mu">{t.guestNone}</p>
          )}
          {hasGuest && guestButtons}
          {hasGuest && !accountHasData && <p className="text-[11px] text-mu">{t.copyHint}</p>}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-s2/40 p-3.5 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-mu">{t.guestOwnTitle}</div>
            {hasGuest && guest ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-serif text-base font-bold text-tx break-all">{guest.nickname}</span>
                <span className="text-xs text-mu">{formatString(t.levelLabel, { level: formatNumber(lang, guest.level) })}</span>
                <span className="text-xs text-mu">{formatString(t.tradesLabel, { count: formatNumber(lang, guest.tradesCount) })}</span>
              </div>
            ) : (
              <p className="text-xs text-mu">{t.noGuestData}</p>
            )}
          </div>
          {hasGuest && guestButtons}
        </>
      )}

      {hasGuest && !user && <p className="text-[11px] text-mu">{t.guestOnlyNote}</p>}

      {user && (
        <div className="border-t border-line/60 pt-3">
          <button
            type="button"
            onClick={startSignOutDelete}
            disabled={busy}
            className={`btn-danger text-left ${btnBase}`}
          >
            <LogOut size={14} className="shrink-0" aria-hidden="true" />
            <span>{t.signOutDeleteBtn}</span>
          </button>
        </div>
      )}

      <div aria-live="polite">
        {status && (
          <p
            role={status.kind === "error" ? "alert" : undefined}
            className={`rounded-xl border p-3 text-xs ${
              status.kind === "ok"
                ? "border-vi/40 bg-pri/20 text-tx"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            {status.text}
          </p>
        )}
      </div>

      <ConfirmDialog
        isOpen={dialog === "deleteGuest"}
        title={t.deleteGuestTitle}
        description={t.deleteGuestDescription}
        warningNote={t.deleteGuestWarning}
        confirmLabel={t.deleteGuestBtn}
        cancelLabel={t.cancelBtn}
        matchText={t.deleteGuestConfirmWord}
        matchPromptLabel={t.confirmPrompt}
        isDanger
        onConfirm={handleDeleteGuest}
        onCancel={() => setDialog(null)}
      />
      <UnsyncedSignOutWarning isOpen={dialog === "unsynced"} onCancel={() => setDialog(null)} onProceed={openSignOutConfirm} />
      <ConfirmDialog
        isOpen={dialog === "signOutDelete"}
        title={t.signOutDeleteTitle}
        description={t.signOutDeleteDescription}
        warningNote={signOutWarning ?? t.signOutDeleteWarning}
        confirmLabel={t.signOutDeleteConfirmBtn}
        cancelLabel={t.cancelBtn}
        matchText={t.signOutDeleteConfirmWord}
        matchPromptLabel={t.confirmPrompt}
        isDanger
        onConfirm={handleSignOutDelete}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
