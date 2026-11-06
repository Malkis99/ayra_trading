"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { AppStorage } from "@/lib/storage";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { decideLocale, decideTimezone, readLocaleSync, readTimezoneSync, writeTimezoneSync, type TimezoneAction, type LocaleSyncState, LOCALE_CHOICE_EVENT, recordLocaleChoice, acknowledgeLocale } from "@/lib/profile-timezone";
import { readSyncState } from "@/lib/journal/cloud/sync-state";

/** The interface language chosen on this device (none: never chosen here, the device only takes the account's). */
function chosenLanguage(): "ru" | "en" | null {
  try {
    const v = AppStorage.getItem("ayra_lang");
    return v === "ru" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Exchanges the account's time zone and interface language with the cloud profile (lib/profile-timezone.ts:
 * `profiles.timezone`, `profiles.locale`). Renders nothing.
 * Runs after every cloud exchange of the journal (so «Manual» waits for «Synchronise», like the journal) and, in
 * «Automatic», right after the zone is changed here. Only for a signed-in account with cloud sync on; guests never.
 */
export function ProfileTimezoneSync() {
  const { user, isSpaceReady } = useAuth();
  const { gameState, updateTimezone, isLoaded } = useGame();
  const { cloudActive, cloudStatus, syncMode } = useJournal();
  const { lang, setLanguage } = useApp();
  const local = gameState.profile.timezone || null;
  // re-read on every change of the language here
  const localLang = lang ? chosenLanguage() : null;
  const running = useRef(false);
  const attemptedLocale = useRef<string | null>(null);
  const queued = useRef<{ localeOnly: boolean; intent: LocaleSyncState; userId: string } | null>(null);
  const latest = useRef({ userId: user?.id, ready: false, cloudActive, syncMode, local, localLang });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ready = Boolean(user && isSpaceReady && isLoaded);
  const session = useRef({ key: "", version: 0 });
  const sessionKey = `${user?.id ?? ""}:${ready}:${cloudActive}`;
  if (session.current.key !== sessionKey) session.current = { key: sessionKey, version: session.current.version + 1 };

  latest.current = { userId: user?.id, ready, cloudActive, syncMode, local, localLang };

  // A change made here (Settings, setup window, onboarding answers) after the zone was exchanged once
  useEffect(() => {
    if (!ready || !user || !local) return;
    const st = readTimezoneSync(user.id);
    if (st.synced !== null && local !== st.synced && !st.dirty) {
      writeTimezoneSync(user.id, { ...st, dirty: true, changedAt: new Date().toISOString() });
    }
  }, [ready, user, local]);
  const exchangeRef = useRef<(localeOnly?: boolean, intent?: LocaleSyncState) => Promise<void>>(async () => {});
  const exchange = useCallback(async (localeOnly = false, manualIntent?: LocaleSyncState) => {
    const start = latest.current;
    if (!start.ready || !start.userId || !start.cloudActive) return;
    const id = start.userId;
    const authorized = manualIntent ?? readLocaleSync(id);
    let handledRevision = authorized.revision ?? 0;
    if (localeOnly && (!authorized.dirty || start.syncMode !== "auto")) return;
    if (running.current) {
      const previous = queued.current;
      queued.current = { localeOnly: localeOnly && previous?.localeOnly !== false,
        intent: authorized, userId: id };
      return;
    }
    const attemptKey = `${session.current.version}:${id}:${authorized.revision ?? 0}`;
    // The click handler and a delayed React effect can observe the same unsent choice.
    // An error must not turn that delayed effect into an unsolicited retry.
    if (localeOnly && attemptedLocale.current === attemptKey) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    running.current = true;
    if (authorized.dirty) attemptedLocale.current = attemptKey;
    const sessionVersion = session.current.version;
    const active = () => mounted.current && session.current.version === sessionVersion && latest.current.ready && latest.current.cloudActive && latest.current.userId === id;
    try {
      const { data, error } = await supabase.from("profiles").select("timezone, locale, updated_at").eq("id", id).maybeSingle();
      if (error || !data || !active()) return;
      const current = latest.current;
      // Manual authorisation covers only the choice present when Synchronise was pressed.
      const intent = current.syncMode === "auto" && start.syncMode === "auto" ? readLocaleSync(id) : authorized;
      const revision = intent.revision ?? 0;
      handledRevision = revision;
      if (intent.dirty) attemptedLocale.current = `${sessionVersion}:${id}:${revision}`;
      const updatedAt = data.updated_at ?? null;
      const tz = localeOnly ? { kind: "none" } as const : decideTimezone(start.local, { timezone: data.timezone ?? null, updatedAt }, readTimezoneSync(id));
      const lng = intent.dirty && intent.pending
        ? intent.pending === data.locale ? { kind: "none" } as const : { kind: "push", value: intent.pending } as const
        : decideLocale(start.localLang, { locale: data.locale ?? null, updatedAt }, intent);
      const up: { timezone?: string; locale?: string } = {};
      if (tz.kind === "push") up.timezone = tz.value;
      if (lng.kind === "push") up.locale = lng.value;
      if (up.timezone || up.locale) {
        const { error: upErr } = await supabase.from("profiles").update(up).eq("id", id);
        if (!active()) return;
        if (!upErr && up.timezone) writeTimezoneSync(id, { synced: up.timezone, dirty: false });
        if (!upErr && up.locale) acknowledgeLocale(id, up.locale, revision);
      }
      const settle = (action: TimezoneAction, mine: string | null, theirs: string | null, write: (v: string) => void, apply: (v: string) => void) => {
        if (action.kind === "take") { write(action.value); apply(action.value); }
        else if (action.kind === "none" && mine && mine === theirs) write(mine);
      };
      if (!localeOnly) settle(tz, start.local, data.timezone ?? null, (v) => writeTimezoneSync(id, { synced: v, dirty: false }), updateTimezone);
      // A late read must never apply over an explicit choice made during that read or PATCH.
      if ((readLocaleSync(id).revision ?? 0) === revision) {
        if (lng.kind === "take") {
          acknowledgeLocale(id, lng.value, revision);
          setLanguage(lng.value === "en" ? "en" : "ru", "cloud");
        } else if (lng.kind === "none" && (data.locale === "ru" || data.locale === "en")) {
          acknowledgeLocale(id, data.locale, revision);
        }
      }
    } catch {
      // Keep the pending choice. Retry only on a new choice or an authorised exchange.
    } finally {
      running.current = false;
      const next = queued.current;
      queued.current = null;
      if (next && mounted.current && latest.current.ready && latest.current.cloudActive && latest.current.userId === next.userId) {
        // Coalesce duplicate triggers; failures do not start a retry loop.
        const pending = readLocaleSync(next.userId);
        if (!next.localeOnly || (pending.dirty && (next.userId !== id || (pending.revision ?? 0) > handledRevision))) {
          void exchangeRef.current(next.localeOnly, latest.current.syncMode === "manual" ? next.intent : undefined);
        }
      }
    }
  }, [setLanguage, updateTimezone]);
  exchangeRef.current = exchange;

  useEffect(() => {
    const choose = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      const current = latest.current;
      if (!current.ready || !current.userId || (value !== "ru" && value !== "en")) return;
      recordLocaleChoice(current.userId, value);
      if (current.syncMode === "auto") void exchangeRef.current(true);
    };
    window.addEventListener(LOCALE_CHOICE_EVENT, choose);
    return () => window.removeEventListener(LOCALE_CHOICE_EVENT, choose);
  }, []);

  // After each NEW exchange of the journal with the cloud (manual mode: only after «Synchronise»). The time of the
  // previous session's last exchange, seen on start, is not a new exchange: nothing runs on open in «Manual».
  const seenSync = useRef<{ user: string; at: string | undefined } | null>(null);
  useEffect(() => {
    if (!ready || !user) return;
    const at = cloudStatus.lastSyncAt;
    if (!seenSync.current || seenSync.current.user !== user.id) {
      // baseline = the last exchange stored on this device (the screen state may still be loading)
      seenSync.current = { user: user.id, at: readSyncState(user.id).lastSyncAt };
      if (at === seenSync.current.at || !at) return;
    }
    if (at && at !== seenSync.current.at) {
      seenSync.current = { user: user.id, at };
      void exchange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudStatus.lastSyncAt, ready, user]);

  // Automatic: a zone or language changed here goes up at once
  useEffect(() => {
    if (!ready || !user || syncMode !== "auto") return;
    if (readTimezoneSync(user.id).dirty || readLocaleSync(user.id).dirty) void exchange(!readTimezoneSync(user.id).dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, localLang, syncMode, ready, cloudActive]);

  return null;
}
