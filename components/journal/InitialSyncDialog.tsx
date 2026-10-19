"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CloudUpload, Download, Loader2 } from "lucide-react";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { listImportBatches } from "@/lib/journal/import/batches";
import { journalBackupFileName, journalBackupJson } from "@/lib/journal/export";
import type { InitialSyncPlan, InitialSyncResult } from "@/lib/journal/cloud/sync-engine";
import { Button, Modal } from "@/components/ui";

type Phase = "checking" | "preview" | "uploading" | "cancelled" | "done" | "error";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * T7b-4d: the first upload of this device's journal to the cloud (by the button only). Shows what will go up and
 * what is already in the cloud, offers a JSON backup first, uploads with progress, can be cancelled and continued
 * without copies. Different records never overwrite the cloud: they become conflicts (dialog of 4c).
 */
export function InitialSyncDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { analyzeInitialSync, runInitialSync, getAllRecords } = useJournal();
  const { dict } = useApp();
  const t = dict.journal.initialSync;
  const [phase, setPhase] = useState<Phase>("checking");
  const [plan, setPlan] = useState<InitialSyncPlan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<InitialSyncResult | null>(null);
  const [errorText, setErrorText] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const cancelRef = useRef(false);

  const analyze = useCallback(async () => {
    setPhase("checking");
    try {
      setPlan(await analyzeInitialSync());
      setPhase("preview");
    } catch (e) {
      setErrorText((e as Error)?.name === "SyncAbortedError" ? t.switched : t.error);
      setPhase("error");
    }
  }, [analyzeInitialSync, t.error, t.switched]);

  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current = false;
    setCancelling(false);
    setResult(null);
    void analyze();
  }, [isOpen, analyze]);

  const start = async () => {
    cancelRef.current = false;
    setCancelling(false);
    setProgress({ done: 0, total: plan?.toUpload.length ?? 0 });
    setPhase("uploading");
    try {
      const res = await runInitialSync({ onProgress: (done, total) => setProgress({ done, total }), shouldCancel: () => cancelRef.current });
      setResult(res);
      setPhase(res.cancelled ? "cancelled" : "done");
    } catch (e) {
      setErrorText((e as Error)?.name === "SyncAbortedError" ? t.switched : t.error);
      setPhase("error");
    }
  };

  const cancel = () => {
    cancelRef.current = true;
    setCancelling(true);
  };

  const backup = () => download(journalBackupFileName(), journalBackupJson(getAllRecords(), listImportBatches()));

  // what goes up, by kind of record
  const counts = new Map<string, number>();
  for (const e of plan?.toUpload ?? []) counts.set(e.table, (counts.get(e.table) ?? 0) + 1);
  const cloudOnlyLive = (plan?.onlyCloud ?? []).filter((e) => !e.record.deletedAt && !e.record.undoneAt).length;
  const skippedName = (s: InitialSyncPlan["skipped"][number]) => {
    const all = getAllRecords();
    const trade = s.table === "journal_trades" ? all.trades.find((x) => x.id === s.id) : undefined;
    const note = s.table === "journal_notes" ? all.notes.find((x) => x.id === s.id) : undefined;
    const label = trade ? `${trade.instrument} · ${trade.openedAt.slice(0, 10)}` : note ? note.title || note.body.slice(0, 40) : s.id;
    return `${t.kinds[s.table as keyof typeof t.kinds] ?? s.table}: ${label}`;
  };

  const busy = phase === "uploading";
  const footer =
    phase === "preview" ? (
      <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
        <Button onClick={start} data-testid="initial-sync-start">
          <CloudUpload size={16} aria-hidden="true" />
          {t.start}
        </Button>
      </div>
    ) : phase === "uploading" ? (
      <div className="flex w-full justify-end">
        <Button variant="secondary" onClick={cancel} disabled={cancelling} data-testid="initial-sync-cancel">
          {t.cancel}
        </Button>
      </div>
    ) : phase === "cancelled" ? (
      <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
        <Button onClick={start} data-testid="initial-sync-resume">
          {t.resume}
        </Button>
      </div>
    ) : phase === "error" ? (
      <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
        <Button onClick={analyze}>{t.retry}</Button>
      </div>
    ) : phase === "done" ? (
      <div className="flex w-full justify-end">
        <Button onClick={onClose} data-testid="initial-sync-close">
          {t.close}
        </Button>
      </div>
    ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? cancel : onClose}
      title={t.title}
      closeLabel={t.close}
      size="lg"
      sheetOnMobile
      footer={footer}
      data-testid="initial-sync-dialog"
    >
      {phase === "checking" && (
        <p className="flex items-center gap-2 text-sm text-tx" role="status">
          <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
          {t.checking}
        </p>
      )}

      {phase === "preview" && plan && (
        <div className="space-y-4">
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-tx">{t.lead}</h4>
            {counts.size === 0 ? (
              <p className="text-sm text-tx/80">{t.nothingToUpload}</p>
            ) : (
              <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="initial-sync-counts">
                {[...counts].map(([table, n]) => (
                  <div key={table} className="flex items-baseline justify-between gap-3 rounded-md bg-s2/60 px-3 py-1.5 text-sm" data-kind={table}>
                    <dt className="text-tx/80">{t.kinds[table as keyof typeof t.kinds] ?? table}</dt>
                    <dd className="font-semibold tabular-nums text-tx">{n}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {plan.cloudLive > 0 && (
            <section className="space-y-2 rounded-md border border-vi/40 bg-vi/10 p-3" data-testid="initial-sync-both">
              <p className="text-sm font-semibold text-tx">{formatString(t.both, { local: plan.toUpload.length, cloud: cloudOnlyLive, diff: plan.differ.length })}</p>
              <p className="text-xs text-tx/80">{t.bothHint}</p>
              <p className="flex items-start gap-2 text-xs text-tx">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                {t.duplicates}
              </p>
            </section>
          )}

          {plan.skipped.length > 0 && (
            <section className="space-y-1 rounded-md border border-amber-300/40 bg-amber-300/10 p-3" data-testid="initial-sync-skipped">
              <p className="text-sm font-semibold text-tx">{formatString(t.skippedTitle, { count: plan.skipped.length })}</p>
              <ul className="space-y-0.5 text-xs text-tx/90">
                {plan.skipped.map((s) => (
                  <li key={`${s.table}:${s.id}`}>
                    {skippedName(s)} — {t.skipped[s.reason]}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-2 rounded-md border border-line bg-s2/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-tx">{t.backup}</p>
            <Button variant="secondary" onClick={backup} className="shrink-0" data-testid="initial-sync-backup">
              <Download size={16} aria-hidden="true" />
              {t.backupButton}
            </Button>
          </section>

          <p className="text-xs text-tx/70">{t.noAttachments}</p>
        </div>
      )}

      {phase === "uploading" && (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-tx" data-testid="initial-sync-progress">
            {formatString(t.progress, { done: progress.done, total: progress.total })}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-s2" aria-hidden="true">
            <div className="h-full rounded-full bg-vi transition-[width]" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
          {cancelling && <p className="text-xs text-tx/80">{t.cancelling}</p>}
        </div>
      )}

      {phase === "cancelled" && result && (
        <p className="text-sm text-tx" role="status" data-testid="initial-sync-cancelled">
          {formatString(t.cancelled, { done: result.uploaded, total: result.total })}
        </p>
      )}

      {phase === "done" && result && (
        <div className="space-y-2" role="status" data-testid="initial-sync-done">
          <p className="text-base font-semibold text-tx">{t.done}</p>
          <p className="text-sm text-tx/90">{formatString(t.doneDetails, { uploaded: result.uploaded, downloaded: result.downloaded })}</p>
          {result.conflicts > 0 && <p className="text-sm text-amber-200">{formatString(t.doneConflicts, { count: result.conflicts })}</p>}
        </div>
      )}

      {phase === "error" && (
        <p className="text-sm text-tx" role="alert">
          {errorText}
        </p>
      )}
    </Modal>
  );
}

/** "Upload to the cloud" in the Journal header: only for a signed-in account with sync on, until the first sync. */
export function InitialSyncButton() {
  const { initialSync, openInitialSync } = useJournal();
  const { dict } = useApp();
  if (!initialSync.needed) return null;
  const label = initialSync.started ? dict.journal.initialSync.buttonContinue : dict.journal.initialSync.button;
  return (
    <Button variant="secondary" onClick={openInitialSync} data-testid="initial-sync-button">
      <CloudUpload size={18} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </Button>
  );
}

/** The one first-upload window of the app (opened by the Journal button or the header badge). */
export function GlobalInitialSyncDialog() {
  const { initialSyncOpen, closeInitialSync } = useJournal();
  return <InitialSyncDialog isOpen={initialSyncOpen} onClose={closeInitialSync} />;
}

/** One notice when an empty device downloaded the journal from the cloud by itself (anywhere in the app). */
export function CloudDownloadNotice() {
  const { cloudDownloadNotice, clearCloudDownloadNotice } = useJournal();
  const { dict, showToast } = useApp();
  useEffect(() => {
    if (!cloudDownloadNotice) return;
    showToast(dict.journal.initialSync.downloadedNotice);
    clearCloudDownloadNotice();
  }, [cloudDownloadNotice, clearCloudDownloadNotice, showToast, dict]);
  return null;
}
