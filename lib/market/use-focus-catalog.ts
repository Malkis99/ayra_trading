"use client";

import { useEffect, useRef, useState } from "react";
import { AppStorage } from "@/lib/storage";
import { focusStorage, subscribeFocus } from "@/lib/storage/market-focus";
import { captureMarketAccount } from "./account-scope";
import { FocusDataError } from "./market-focus";
import type { CatalogCommand, CatalogSnapshot } from "./focus-catalog";
import type { InstrumentId } from "./instruments";

type View = { snapshot?: CatalogSnapshot; pending: boolean; issue?: FocusDataError["kind"] };
export function useFocusCatalog(space: string, instrument: InstrumentId) {
  const [view, setView] = useState<View>({ pending: false });
  const api = useRef<{ change: (command: CatalogCommand) => Promise<boolean>; reload: () => void } | null>(null);
  useEffect(() => {
    const scope = captureMarketAccount(() => AppStorage.getUserId());
    let live = true, generation = 0, mutation = 0, ticket: number | undefined, busy = false, value: CatalogSnapshot | undefined, issue: FocusDataError["kind"] | undefined;
    const current = () => live && scope.current();
    const publish = () => { if (current()) setView({ snapshot: value, pending: busy, issue }); };
    const accept = (next: CatalogSnapshot) => { if (!value || next.catalog.revision >= value.catalog.revision) value = next; };
    const reload = async (retry = false) => {
      const request = ++generation;
      try {
        if (ticket === undefined || retry) { const next = await focusStorage.epoch(space); if (!current() || request !== generation) return; ticket = next; }
        const operationTicket = ticket, next = await focusStorage.catalog(space);
        if (!current() || request !== generation || ticket !== operationTicket) return;
        accept(next); if (retry) issue = undefined; publish();
      } catch (error) { if (current() && request === generation) { issue = error instanceof FocusDataError ? error.kind : "storage"; publish(); } }
    };
    api.current = {
      change: async command => {
        if (!current() || ticket === undefined || busy || issue || !value) return false;
        const operationTicket = ticket, operation = ++mutation; busy = true; publish();
        try {
          const next = await focusStorage.changeCatalog(space, instrument, command, operationTicket, () => current() && ticket === operationTicket && operation === mutation);
          if (!current() || ticket !== operationTicket || operation !== mutation) return false;
          accept(next); return true;
        } catch (error) { if (current() && ticket === operationTicket) issue = error instanceof FocusDataError ? error.kind : "storage"; return false; }
        finally { if (current() && ticket === operationTicket && operation === mutation) { busy = false; publish(); if (!issue) void reload(); } }
      },
      reload: () => { if (current() && !busy) void reload(true); },
    };
    const off = subscribeFocus(notice => {
      if (notice.spaceId !== space || !current()) return;
      if (notice.instrumentId === null) { ++generation; ++mutation; ticket = undefined; value = undefined; busy = false; issue = "cleared"; publish(); }
      else if (!busy && issue !== "cleared") void reload();
    });
    const visible = () => { if (!document.hidden && !busy && issue !== "cleared") void reload(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible); void reload();
    return () => { live = false; scope.dispose(); off(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); api.current = null; };
  }, [space, instrument]);
  return { ...view, api: api.current };
}
