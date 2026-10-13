"use client";

import React, { useState, useEffect, useCallback } from "react";
import { spaceTabChannel, dirtyFormRegistry } from "@/lib/auth/space-channel";
import { AppStorage, GUEST_SPACE_ID } from "@/lib/storage";
import { useApp } from "@/lib/context";
import { AlertTriangle, RefreshCw, Copy } from "lucide-react";

export function SpaceChangeBanner() {
  const { dict, showToast } = useApp();
  const [pendingChange, setPendingChange] = useState<{
    fromSpaceId: string;
    toSpaceId: string;
  } | null>(null);

  const [flushError, setFlushError] = useState<{
    message: string;
    textToCopy?: string;
  } | null>(null);

  const [isFlushing, setIsFlushing] = useState(false);

  const applySpaceSwitch = useCallback((toSpaceId: string) => {
    const targetUserId =
      toSpaceId === GUEST_SPACE_ID || toSpaceId.startsWith("guest")
        ? null
        : toSpaceId.replace(/^account:/, "");

    const fromSpaceId = AppStorage.getActiveSpaceId();
    AppStorage.setUserId(targetUserId);
    setPendingChange(null);
    setFlushError(null);

    // Providers of this tab must reload from the new space; broadcastSpaceChange only reaches other tabs
    spaceTabChannel.notifyLocal(fromSpaceId, toSpaceId);
    spaceTabChannel.broadcastSpaceChange(fromSpaceId, toSpaceId);
  }, []);

  useEffect(() => {
    const unsubscribe = spaceTabChannel.subscribe((msg) => {
      if (msg.type === "SPACE_CHANGED") {
        const currentActiveSpace = AppStorage.getActiveSpaceId();
        if (currentActiveSpace !== msg.toSpaceId) {
          if (dirtyFormRegistry.isAnyFormDirty()) {
            setPendingChange({
              fromSpaceId: msg.fromSpaceId,
              toSpaceId: msg.toSpaceId,
            });
          } else {
            applySpaceSwitch(msg.toSpaceId);
          }
        }
      }
    });

    return () => unsubscribe();
  }, [applySpaceSwitch]);

  // Check if dirty form became clean while banner is open
  useEffect(() => {
    if (!pendingChange) return;

    const interval = setInterval(() => {
      if (!dirtyFormRegistry.isAnyFormDirty()) {
        applySpaceSwitch(pendingChange.toSpaceId);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [pendingChange, applySpaceSwitch]);

  const handleUpdateClick = async () => {
    if (!pendingChange || isFlushing) return;
    setIsFlushing(true);

    try {
      // 1. Flush dirty forms
      const formRes = await dirtyFormRegistry.flushAllDirtyForms();
      if (!formRes.success) {
        setFlushError({
          message: formRes.error || "Flush failed",
          textToCopy: formRes.textToCopy,
        });
        setIsFlushing(false);
        return;
      }

      // 2. Flush space handlers in AppStorage
      const storageRes = await AppStorage.flushSpace(pendingChange.fromSpaceId);
      if (!storageRes.success) {
        setFlushError({
          message: String(storageRes.error || "Storage flush failed"),
        });
        setIsFlushing(false);
        return;
      }

      // 3. Switch space and reset state
      applySpaceSwitch(pendingChange.toSpaceId);
    } catch (err) {
      setFlushError({
        message: err instanceof Error ? err.message : "Flush error",
      });
    } finally {
      setIsFlushing(false);
    }
  };

  const handleCopyText = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      showToast(dict.common?.copied || "Copied to clipboard");
    } catch {}
  };

  if (flushError) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
        <div className="rounded-xl border border-rose-500/50 bg-rose-950/95 p-4 shadow-2xl backdrop-blur-md text-xs text-rose-100 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-rose-300">
            <AlertTriangle size={16} />
            <span>{dict.auth?.flushErrorTitle || "Could not save old space data"}</span>
          </div>

          <p className="text-[11px] text-rose-200">{flushError.message}</p>

          <div className="flex items-center justify-between gap-2 pt-1">
            {flushError.textToCopy ? (
              <button
                type="button"
                onClick={() => handleCopyText(flushError.textToCopy!)}
                className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Copy size={13} />
                <span>{dict.auth?.copyTextBtn || "Copy text"}</span>
              </button>
            ) : <div />}

            <button
              type="button"
              onClick={() => setFlushError(null)}
              className="btn-ghost text-xs py-1.5 px-3 text-rose-300 hover:text-rose-100 cursor-pointer"
            >
              {dict.journal?.cancel || "Cancel"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!pendingChange) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-950/95 p-3.5 shadow-2xl backdrop-blur-md text-xs text-amber-100 max-w-md">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
      <span className="flex-1">
        {dict.auth?.spaceChangedBanner || "Account changed in another tab"}
      </span>
      <button
        type="button"
        onClick={handleUpdateClick}
        disabled={isFlushing}
        className="rounded-lg bg-amber-500 px-3 py-1 font-semibold text-black hover:bg-amber-400 cursor-pointer inline-flex items-center gap-1.5 shrink-0"
      >
        <RefreshCw size={13} className={isFlushing ? "animate-spin" : ""} />
        <span>{dict.auth?.spaceChangedUpdateBtn || "Update"}</span>
      </button>
    </div>
  );
}
