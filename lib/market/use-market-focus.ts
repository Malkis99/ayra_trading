"use client";

import { useEffect, useRef, useState } from "react";
import { AppStorage } from "@/lib/storage";
import { focusStorage, subscribeFocus } from "@/lib/storage/market-focus";
import { captureMarketAccount } from "./account-scope";
import { FocusDataError, patchFocus, type FocusEntry, type FocusPatch } from "./market-focus";
import type { InstrumentId } from "./instruments";

export type FocusIssue = "storage" | "invalid" | "unsupported";
type View = { entry?: FocusEntry; pending: boolean; issue?: FocusIssue };
export const focusIssue = (e: unknown): FocusIssue => e instanceof FocusDataError ? e.kind : "storage";
/** Mounted with an account/epoch/instrument key. Accepted writes remain bound to that exact local row. */
export function useMarketFocus(space: string, id: InstrumentId) {
  const [view, setView] = useState<View>({ pending: false });
  const api = useRef<{ patch: (patch: FocusPatch) => void; reset: (revision: number) => Promise<"saved" | "conflict" | "error">; reload: () => void } | null>(null);
  useEffect(() => {
    const scope = captureMarketAccount(() => AppStorage.getUserId());
    let active = true, confirmed: FocusEntry | undefined, issue: FocusIssue | undefined, generation = 0, sequence = 0;
    let pending: { seq: number; patch: FocusPatch }[] = [], resetting = false;
    const current = () => active && scope.current();
    const publish = () => { if (current()) setView({ entry: confirmed && pending.reduce((entry, op) => patchFocus(entry, op.patch), confirmed), pending: pending.length > 0 || resetting, issue }); };
    const accept = (entry: FocusEntry) => { if (!confirmed || entry.revision >= confirmed.revision) confirmed = entry; };
    const refresh = async (retry = false) => {
      const request = ++generation;
      try { const entry = await focusStorage.read(space, id); if (current() && request === generation) { accept(entry); if (retry) issue = undefined; publish(); } }
      catch (e) { if (current() && request === generation) { issue = focusIssue(e); publish(); } }
    };
    api.current = {
      patch: patch => {
        if (!current() || !confirmed || issue || resetting) return;
        const seq = ++sequence; pending.push({ seq, patch }); publish();
        void focusStorage.patch(space, id, patch).then(entry => { if (current()) accept(entry); }, e => { if (current()) issue = focusIssue(e); }).finally(() => {
          pending = pending.filter(op => op.seq !== seq); publish();
          if (current() && !pending.length && !issue) void refresh();
        });
      },
      reset: async revision => {
        if (!current() || !confirmed || pending.length || resetting || issue) return "error";
        resetting = true; publish();
        try {
          const result = await focusStorage.reset(space, id, revision);
          if (!current()) return "error";
          accept(result.entry); return result.kind;
        } catch (e) { if (current()) issue = focusIssue(e); return "error"; }
        finally { resetting = false; publish(); }
      },
      reload: () => { if (current() && !pending.length && !resetting) void refresh(true); },
    };
    const unsubscribe = subscribeFocus(notice => { if (notice.spaceId === space && notice.instrumentId === id && current() && !pending.length && !resetting) void refresh(); });
    const visible = () => { if (document.visibilityState === "visible" && !pending.length && !resetting) void refresh(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => { active = false; scope.dispose(); unsubscribe(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); api.current = null; };
  }, [space, id]);
  return { ...view, api: api.current };
}
