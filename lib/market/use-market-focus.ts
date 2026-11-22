"use client";

import { useEffect, useRef, useState } from "react";
import { AppStorage } from "@/lib/storage";
import { focusStorage, subscribeFocus } from "@/lib/storage/market-focus";
import { captureMarketAccount } from "./account-scope";
import { FocusDataError, patchFocus, type FocusEntry, type FocusPatch } from "./market-focus";
import type { InstrumentId } from "./instruments";

export type FocusIssue = FocusDataError["kind"];
type View = { entry?: FocusEntry; pending: boolean; issue?: FocusIssue };
export const focusIssue = (e: unknown): FocusIssue => e instanceof FocusDataError ? e.kind : "storage";
/** Mounted with an account/epoch/instrument key. Accepted writes remain bound to that exact local row. */
export function useMarketFocus(space: string, id: InstrumentId) {
  const [view, setView] = useState<View>({ pending: false });
  const api = useRef<{ patch: (patch: FocusPatch) => Promise<boolean>; reset: (revision: number) => Promise<"saved" | "conflict" | "error">; reload: () => void } | null>(null);
  useEffect(() => {
    const scope = captureMarketAccount(() => AppStorage.getUserId());
    let active = true, confirmed: FocusEntry | undefined, issue: FocusIssue | undefined, generation = 0, sequence = 0, ticket: number | undefined;
    let pending: { seq: number; patch: FocusPatch }[] = [], resetting = false;
    const current = () => active && scope.current();
    const publish = () => { if (current()) setView({ entry: confirmed && pending.reduce((entry, op) => { try { return patchFocus(entry, op.patch); } catch { return entry; } }, confirmed), pending: pending.length > 0 || resetting, issue }); };
    const accept = (entry: FocusEntry) => { if (!confirmed || entry.revision >= confirmed.revision) confirmed = entry; };
    const refresh = async (retry = false) => {
      const request = ++generation;
      try {
        if (ticket === undefined || retry) { const next = await focusStorage.epoch(space); if (!current() || request !== generation) return; ticket = next; }
        const entry = await focusStorage.read(space, id, ticket);
        if (current() && request === generation) { accept(entry); if (retry) issue = undefined; publish(); }
      } catch (e) { if (current() && request === generation) { issue = focusIssue(e); if (issue === "cleared") { confirmed = undefined; ticket = undefined; } publish(); } }
    };
    api.current = {
      patch: async patch => {
        if (!current() || !confirmed || issue || resetting || ticket === undefined) return false;
        const operationTicket = ticket;
        const seq = ++sequence; pending.push({ seq, patch }); publish();
        try {
          const entry = await focusStorage.patch(space, id, patch, operationTicket);
          if (!current() || ticket !== operationTicket) return false;
          accept(entry); return true;
        } catch (e) { if (current() && ticket === operationTicket) issue = focusIssue(e); return false; }
        finally {
          pending = pending.filter(op => op.seq !== seq); publish();
          if (current() && !pending.length && !issue) void refresh();
        }
      },
      reset: async revision => {
        if (!current() || !confirmed || pending.length || resetting || issue || ticket === undefined) return "error";
        const operationTicket = ticket;
        resetting = true; publish();
        try {
          const result = await focusStorage.reset(space, id, revision, operationTicket);
          if (!current() || ticket !== operationTicket) return "error";
          accept(result.entry); return result.kind;
        } catch (e) { if (current() && ticket === operationTicket) issue = focusIssue(e); return "error"; }
        finally { resetting = false; publish(); }
      },
      reload: () => { if (current() && !pending.length && !resetting) void refresh(true); },
    };
    const unsubscribe = subscribeFocus(notice => {
      if (notice.spaceId !== space || !current()) return;
      if (notice.instrumentId === null) { generation++; ticket = undefined; confirmed = undefined; pending = []; resetting = false; issue = "cleared"; publish(); }
      else if (notice.instrumentId === id && !pending.length && !resetting) void refresh();
    });
    const visible = () => { if (document.visibilityState === "visible" && !pending.length && !resetting) void refresh(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => { active = false; scope.dispose(); unsubscribe(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); api.current = null; };
  }, [space, id]);
  return { ...view, api: api.current };
}
