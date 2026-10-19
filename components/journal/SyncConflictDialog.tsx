"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Cloud, Smartphone, Trash2 } from "lucide-react";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { formatString, getPlural } from "@/lib/i18n";
import { listImportBatches } from "@/lib/journal/import/batches";
import {
  describeConflict,
  deviceRecord,
  type ConflictField,
  type ConflictView,
} from "@/lib/journal/cloud/conflict-view";
import type { SyncConflictChoice } from "@/lib/journal/types";
import { Button, Modal } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/components/ui/cn";

/**
 * T7b-4c: "This entry was changed on two devices". Opens by itself once per visit of the Journal when there are
 * conflicts (only for a signed-in account with cloud sync on), waits until no other dialog is open, never blocks
 * the Journal: "Decide later" keeps everything as is (the device version stays, nothing is sent).
 */
export function SyncConflictDialog() {
  const { cloudActive, syncConflicts, resolveSyncConflict, getAllRecords, accounts } = useJournal();
  const { dict, lang, showToast } = useApp();
  const t = dict.journal.syncConflict;
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** "For all" asks first, with the number of entries it will replace. */
  const [confirmAll, setConfirmAll] = useState<SyncConflictChoice | null>(null);

  const views = useMemo<ConflictView[]>(() => {
    if (!cloudActive || !syncConflicts.length) return [];
    const snapshot = getAllRecords();
    const batches = listImportBatches();
    return syncConflicts.map((c) =>
      describeConflict(c, deviceRecord(snapshot, batches, c.table, c.id), accounts)
    );
  }, [cloudActive, syncConflicts, getAllRecords, accounts]);

  // Once per visit: only when nothing else (a trade drawer, another dialog) is open
  useEffect(() => {
    if (!views.length || dismissed || open) return;
    const tryOpen = () => {
      if (!document.querySelector('[role="dialog"]')) setOpen(true);
    };
    tryOpen();
    const timer = setInterval(tryOpen, 1000);
    return () => clearInterval(timer);
  }, [views.length, dismissed, open]);

  // Everything decided: close with a short confirmation
  useEffect(() => {
    if (open && views.length === 0) {
      setOpen(false);
      showToast(t.done);
    }
  }, [open, views.length, showToast, t.done]);

  if (!views.length) return null;

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const fmtDateTime = (iso?: string) => {
    if (!iso || Number.isNaN(Date.parse(iso))) return t.empty;
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  };
  const fieldValue = (f: ConflictField, side: "device" | "cloud") => {
    const v = f[side];
    if (!v) return t.empty;
    if (f.id === "direction") return v === "long" ? t.long : v === "short" ? t.short : v;
    if (f.id === "date") return fmtDateTime(v).replace(/,\s*\d{1,2}:\d{2}.*$/, "");
    return v;
  };

  const choose = (v: ConflictView, choice: SyncConflictChoice) =>
    resolveSyncConflict(v.table, v.id, choice);
  const chooseAll = (choice: SyncConflictChoice) =>
    views.forEach((v) => resolveSyncConflict(v.table, v.id, choice));
  const later = () => {
    setDismissed(true);
    setOpen(false);
  };

  const many = views.length > 1;
  const footer = (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p className="text-xs text-mu sm:max-w-[45%]">{t.laterHint}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {many && (
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmAll("device")}
              data-testid="conflict-keep-all"
            >
              {t.keepDeviceAll}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmAll("cloud")}
              data-testid="conflict-take-all"
            >
              {t.takeCloudAll}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={later} data-testid="conflict-later">
          {t.later}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Modal
        isOpen={open}
        onClose={later}
        title={many ? formatString(t.titleMany, { count: views.length }) : t.title}
        subtitle={many ? t.introMany : t.intro}
        closeLabel={t.later}
        size="lg"
        sheetOnMobile
        footer={footer}
        data-testid="sync-conflict-dialog"
      >
        <ul className="space-y-4">
          {views.map((v) => (
            <ConflictCard
              key={`${v.table}:${v.id}`}
              v={v}
              t={t}
              fmtDateTime={fmtDateTime}
              fieldValue={fieldValue}
              onChoose={(c) => choose(v, c)}
            />
          ))}
        </ul>
      </Modal>
      <ConfirmDialog
        isOpen={confirmAll !== null}
        title={confirmAll === "cloud" ? t.confirmAllCloudTitle : t.confirmAllDeviceTitle}
        description={formatString(confirmAll === "cloud" ? t.confirmAllCloud : t.confirmAllDevice, {
          count: views.length,
          entries: getPlural(lang, views.length, dict.plurals.entries),
        })}
        confirmLabel={formatString(t.confirmAllButton, { count: views.length })}
        cancelLabel={t.cancel}
        onConfirm={() => {
          if (confirmAll) chooseAll(confirmAll);
          setConfirmAll(null);
        }}
        onCancel={() => setConfirmAll(null)}
      />
    </>
  );
}

type Texts = ReturnType<typeof useApp>["dict"]["journal"]["syncConflict"];

function ConflictCard({
  v,
  t,
  fmtDateTime,
  fieldValue,
  onChoose,
}: {
  v: ConflictView;
  t: Texts;
  fmtDateTime: (iso?: string) => string;
  fieldValue: (f: ConflictField, side: "device" | "cloud") => string;
  onChoose: (choice: SyncConflictChoice) => void;
}) {
  const situationText =
    v.situation === "deletedInCloud"
      ? v.kind === "trade"
        ? t.deletedInCloudTrade
        : t.deletedInCloud
      : v.situation === "deletedHere"
        ? v.kind === "trade"
          ? t.deletedHereTrade
          : t.deletedHere
        : null;
  const keepHint =
    v.situation === "deletedInCloud"
      ? t.hintKeepRestore
      : v.situation === "deletedHere"
        ? t.hintKeepDelete
        : t.hintKeep;
  const takeHint =
    v.situation === "deletedInCloud"
      ? t.hintTakeDelete
      : v.situation === "deletedHere"
        ? t.hintTakeRestore
        : t.hintTake;

  const side = (which: "device" | "cloud") => {
    const deleted =
      (which === "cloud" && v.situation === "deletedInCloud") ||
      (which === "device" && v.situation === "deletedHere");
    const at = which === "device" ? v.deviceChangedAt : v.cloudChangedAt;
    return (
      <section
        className={cn(
          "rounded-md border p-3",
          which === "device" ? "border-vi/50 bg-vi/10" : "border-line bg-s2/70"
        )}
        aria-label={which === "device" ? t.thisDevice : t.cloud}
        data-testid={`conflict-${which}`}
      >
        <header className="mb-2 flex items-center gap-2 text-sm font-semibold text-tx">
          {which === "device" ? (
            <Smartphone size={16} aria-hidden="true" />
          ) : (
            <Cloud size={16} aria-hidden="true" />
          )}
          {which === "device" ? t.thisDevice : t.cloud}
        </header>
        <p className="mb-2 text-xs text-tx/80">
          {formatString(deleted ? t.deletedAt : t.changedAt, { date: fmtDateTime(at) })}
        </p>
        {deleted ? (
          <p className="flex items-center gap-2 rounded-md bg-danger/10 px-2 py-2 text-sm font-semibold text-danger">
            <Trash2 size={16} aria-hidden="true" />
            {t.deleted}
          </p>
        ) : (
          <dl className="space-y-1.5 text-sm">
            {v.fields.map((f) => (
              <div
                key={f.id}
                className={cn(
                  "flex items-baseline justify-between gap-3 rounded px-1.5 py-0.5",
                  f.differs && "bg-amber-300/15 ring-1 ring-amber-300/40"
                )}
                data-differs={f.differs ? "true" : undefined}
              >
                <dt className="shrink-0 text-xs text-tx/70">{t.fields[f.id]}</dt>
                <dd
                  className={cn(
                    "min-w-0 break-words text-right",
                    f.differs ? "font-semibold text-tx" : "text-tx/90"
                  )}
                >
                  {fieldValue(f, which)}
                  {f.differs && <span className="sr-only"> ({t.differs})</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  };

  return (
    <li className="rounded-lg border border-line bg-s1 p-3 sm:p-4" data-testid="sync-conflict">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-vi/20 px-2 py-0.5 text-xs font-semibold text-tx">
          {t.kinds[v.kind]}
        </span>
        <span className="text-sm font-semibold text-tx">
          {v.label}
          {v.labelDate && (
            <span className="font-normal text-tx/80">
              {" "}
              ·{" "}
              {fieldValue(
                { id: "date", device: v.labelDate, cloud: v.labelDate, differs: false },
                "device"
              )}
            </span>
          )}
        </span>
      </div>
      {situationText && (
        <p className="mb-3 rounded-md border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-tx">
          {situationText}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {side("device")}
        {side("cloud")}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Button className="w-full" onClick={() => onChoose("device")} data-testid="conflict-keep">
            <Smartphone size={16} aria-hidden="true" />
            {t.keepDevice}
          </Button>
          <p className="text-xs text-tx/70">{keepHint}</p>
        </div>
        <div className="space-y-1">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => onChoose("cloud")}
            data-testid="conflict-take"
          >
            <Cloud size={16} aria-hidden="true" />
            {t.takeCloud}
          </Button>
          <p className="text-xs text-tx/70">{takeHint}</p>
        </div>
      </div>
    </li>
  );
}
