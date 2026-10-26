"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Cloud, CloudOff, CloudUpload, Pause, RefreshCw } from "lucide-react";
import { useJournal } from "@/lib/journal/context";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { syncBadge, type SyncBadgeState } from "@/lib/journal/cloud/badge";
import { Button } from "@/components/ui";
import Link from "next/link";
import { settingsHref } from "@/lib/settings/sections";
import { cn } from "@/components/ui/cn";

/** The badge glyph: a different shape for every state (never colour alone). */
function BadgeIcon({ state, busy, conflicts }: { state: SyncBadgeState; busy: boolean; conflicts: number }) {
  if (state === "offline") return <CloudOff size={16} aria-hidden="true" />;
  if (state === "waitingInitial") return <CloudUpload size={16} aria-hidden="true" />;
  // spins only while something is being sent; static with reduced motion
  if (state === "syncing") return <RefreshCw size={16} className={cn(busy && "motion-safe:animate-spin")} aria-hidden="true" />;
  return (
    <span className="relative inline-flex" aria-hidden="true">
      <Cloud size={16} />
      {state === "synced" && (
        <span className="absolute -bottom-1 -right-1 grid h-3 w-3 place-items-center rounded-full bg-long text-ink">
          <Check size={9} strokeWidth={3.5} />
        </span>
      )}
      {state === "manual" && (
        <span className="absolute -bottom-1 -right-1 grid h-3 w-3 place-items-center rounded-full bg-s2 text-tx ring-1 ring-line">
          <Pause size={8} strokeWidth={3} />
        </span>
      )}
      {state === "error" && (
        <span className="absolute -bottom-1 -right-1 grid h-3 w-3 place-items-center rounded-full bg-danger text-white">
          <AlertTriangle size={8} strokeWidth={3} />
        </span>
      )}
      {state === "conflict" && (
        <span className="absolute -right-2 -top-2 grid h-4 min-w-[16px] place-items-center rounded-full bg-amber-300 px-1 text-[10px] font-bold leading-none text-ink">
          {conflicts > 9 ? "9+" : conflicts}
        </span>
      )}
    </span>
  );
}

/**
 * T7b-4e: cloud badge in the header (coins → cloud → bell → plan → avatar). Only for a signed-in account with cloud sync
 * on. A click shows what is going on, the last sync and what waits to be sent, with the one action that helps.
 */
export function SyncBadge() {
  const { cloudActive, cloudStatus, online, initialSync, syncConflicts, syncNow, openInitialSync, requestConflictDialog } = useJournal();
  const { dict, lang } = useApp();
  const t = dict.journal.syncBadge;
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on a click outside or Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const conflicts = syncConflicts.length;
  const view = syncBadge({
    cloudActive,
    state: cloudStatus.state,
    pending: cloudStatus.pending,
    blocked: cloudStatus.blocked,
    conflicts,
    initialNeeded: initialSync.needed,
    online,
  });
  if (!view) return null;

  const label = view.state === "conflict" ? formatString(t.labels.conflict, { count: conflicts }) : t.labels[view.state];
  const description =
    view.state === "error" && cloudStatus.lastError === "deviceClockAhead" ? t.descriptions.clockAhead : t.descriptions[view.state];
  const lastSync = (() => {
    if (!cloudStatus.lastSyncAt) return t.never;
    const diffSec = Math.round((Date.parse(cloudStatus.lastSyncAt) - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { numeric: "auto" });
    const abs = Math.abs(diffSec);
    const text =
      abs < 60 ? rtf.format(0, "minute") : abs < 3600 ? rtf.format(Math.round(diffSec / 60), "minute") : abs < 86400 ? rtf.format(Math.round(diffSec / 3600), "hour") : rtf.format(Math.round(diffSec / 86400), "day");
    return formatString(t.lastSync, { time: text });
  })();

  const act = async () => {
    if (view.action === "resolve") {
      setOpen(false);
      requestConflictDialog();
    } else if (view.action === "upload") {
      setOpen(false);
      openInitialSync();
    } else if (view.action === "retry" || view.action === "sync") {
      setRetrying(true);
      await syncNow();
      setRetrying(false);
    }
  };

  const tone =
    view.state === "error"
      ? "border-danger/50 text-danger"
      : view.state === "conflict"
        ? "border-amber-300/60 text-amber-200"
        : view.state === "offline"
          ? "border-line text-tx/80"
          : "border-line text-tx/90";

  return (
    <div ref={wrapRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        data-testid="sync-badge"
        data-state={view.state}
        className={cn("grid h-[34px] w-[34px] place-items-center rounded-xl border bg-s1 transition-colors hover:border-vi hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", tone)}
      >
        <BadgeIcon state={view.state} busy={view.busy || retrying} conflicts={conflicts} />
      </button>
      {/* polite announcement of state changes */}
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      {open && (
        <div
          // phone: a full-width panel under the header (never off screen); wider screens: under the badge
          className="fixed inset-x-4 top-14 z-30 space-y-2 rounded-xl border border-line bg-s1 p-3 text-sm shadow-float sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[300px]"
          aria-label={label}
          data-testid="sync-badge-panel"
        >
          <p className="font-semibold text-tx">{label}</p>
          <p className="text-xs text-tx/85">{description}</p>
          <dl className="space-y-0.5 text-xs text-tx/80">
            <div>{lastSync}</div>
            {cloudStatus.pending > 0 && <div data-testid="sync-badge-pending">{formatString(t.pending, { count: cloudStatus.pending })}</div>}
            {cloudStatus.blocked > 0 && <div>{formatString(t.blocked, { count: cloudStatus.blocked })}</div>}
          </dl>
          {(cloudStatus.noSpace ?? 0) > 0 && (
            <p className="text-xs text-amber-300" data-testid="sync-badge-no-space">
              {t.noSpace}
            </p>
          )}
          {view.action && (
            <Button size="sm" className="w-full" onClick={act} disabled={retrying} data-testid="sync-badge-action">
              {t.actions[view.action]}
            </Button>
          )}
          {/* Cloud settings: mode, status, data on this device */}
          <Link
            href={settingsHref("cloud")}
            onClick={() => setOpen(false)}
            className="block text-center text-xs font-semibold text-vi hover:underline"
            data-testid="sync-badge-settings"
          >
            {dict.settings.sections.openCloudSettings}
          </Link>
        </div>
      )}
    </div>
  );
}
