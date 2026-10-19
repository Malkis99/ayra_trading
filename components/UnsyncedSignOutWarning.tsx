"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { formatString, getPlural } from "@/lib/i18n";
import { SYNC_WAIT_BEFORE_DELETE_MS } from "@/lib/journal/cloud/config";
import { Button, Modal } from "@/components/ui";

/**
 * T7b-4e: before "Sign out and delete account data from this device" — when changes are not in the cloud yet or
 * conflicts wait for a choice, say how many and offer: wait for sending (up to 30 s), delete anyway, or cancel.
 */
export function UnsyncedSignOutWarning({ isOpen, onCancel, onProceed }: { isOpen: boolean; onCancel: () => void; onProceed: () => void }) {
  const { readUnsynced, syncNow } = useJournal();
  const { dict, lang } = useApp();
  const t = dict.deviceData.unsynced;
  const [counts, setCounts] = useState({ pending: 0, conflicts: 0 });
  const [waiting, setWaiting] = useState(false);
  const [notAll, setNotAll] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    cancelled.current = false;
    setNotAll(false);
    setCounts(readUnsynced());
  }, [isOpen, readUnsynced]);

  const wait = async () => {
    setWaiting(true);
    setNotAll(false);
    const deadline = Date.now() + SYNC_WAIT_BEFORE_DELETE_MS;
    let now = readUnsynced();
    while (!cancelled.current && now.pending > 0 && Date.now() < deadline) {
      await syncNow();
      now = readUnsynced();
      setCounts(now);
      if (now.pending > 0) await new Promise((r) => setTimeout(r, 1000));
    }
    setWaiting(false);
    if (cancelled.current) return;
    if (now.pending === 0 && now.conflicts === 0) onProceed(); // everything is in the cloud: the usual confirmation
    else setNotAll(true);
  };

  const cancel = () => {
    cancelled.current = true;
    setWaiting(false);
    onCancel();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={cancel}
      title={t.title}
      closeLabel={t.cancel}
      size="lg"
      sheetOnMobile
      data-testid="unsynced-warning"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="whitespace-nowrap" onClick={cancel} data-testid="unsynced-cancel">
            {t.cancel}
          </Button>
          <Button variant="danger" className="whitespace-nowrap" onClick={onProceed} disabled={waiting} data-testid="unsynced-delete">
            {t.proceed}
          </Button>
          <Button className="whitespace-nowrap" onClick={wait} disabled={waiting || counts.pending === 0} data-testid="unsynced-wait">
            {waiting && <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
            {t.wait}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-tx">
        <p className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
          <span>{t.body}</span>
        </p>
        <ul className="space-y-1" data-testid="unsynced-counts">
          {counts.pending > 0 && <li>{formatString(t.pending, { count: counts.pending, changes: getPlural(lang, counts.pending, dict.plurals.changes) })}</li>}
          {counts.conflicts > 0 && <li>{formatString(t.conflicts, { count: counts.conflicts, entries: getPlural(lang, counts.conflicts, dict.plurals.entries) })}</li>}
        </ul>
        {counts.conflicts > 0 && <p className="text-xs text-tx/80">{t.conflictsHint}</p>}
        {waiting && (
          <p className="text-xs text-tx/80" role="status">
            {formatString(t.waiting, { count: counts.pending })}
          </p>
        )}
        {notAll && (
          <p className="text-xs text-amber-200" role="status" data-testid="unsynced-not-all">
            {t.notAll}
          </p>
        )}
      </div>
    </Modal>
  );
}
