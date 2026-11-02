"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { AppStorage } from "@/lib/storage";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { decideLocale, decideTimezone, readLocaleSync, readTimezoneSync, writeLocaleSync, writeTimezoneSync, type TimezoneAction } from "@/lib/profile-timezone";
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
  const ready = Boolean(user && isSpaceReady && isLoaded);

  // A change made here (Settings, setup window, onboarding answers) after the zone was exchanged once
  useEffect(() => {
    if (!ready || !user || !local) return;
    const st = readTimezoneSync(user.id);
    if (st.synced !== null && local !== st.synced && !st.dirty) {
      writeTimezoneSync(user.id, { ...st, dirty: true, changedAt: new Date().toISOString() });
    }
  }, [ready, user, local]);
  useEffect(() => {
    if (!ready || !user || !localLang) return;
    const st = readLocaleSync(user.id);
    if (st.synced !== null && localLang !== st.synced && !st.dirty) {
      writeLocaleSync(user.id, { ...st, dirty: true, changedAt: new Date().toISOString() });
    }
  }, [ready, user, localLang]);

  const exchange = useCallback(async () => {
    if (!ready || !user || !cloudActive || running.current) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    running.current = true;
    try {
      const { data, error } = await supabase.from("profiles").select("timezone, locale, updated_at").eq("id", user.id).maybeSingle();
      if (error || !data) return;
      const updatedAt = data.updated_at ?? null;
      const tz = decideTimezone(local, { timezone: data.timezone ?? null, updatedAt }, readTimezoneSync(user.id));
      const lng = decideLocale(localLang, { locale: data.locale ?? null, updatedAt }, readLocaleSync(user.id));
      // what goes up: both in one request
      const up: { timezone?: string; locale?: string } = {};
      if (tz.kind === "push") up.timezone = tz.value;
      if (lng.kind === "push") up.locale = lng.value;
      if (up.timezone || up.locale) {
        const { error: upErr } = await supabase.from("profiles").update(up).eq("id", user.id);
        if (!upErr && up.timezone) writeTimezoneSync(user.id, { synced: up.timezone, dirty: false });
        if (!upErr && up.locale) writeLocaleSync(user.id, { synced: up.locale, dirty: false });
      }
      const settle = (action: TimezoneAction, mine: string | null, theirs: string | null, write: (v: string) => void, apply: (v: string) => void) => {
        if (action.kind === "take") {
          // remember first, so the change below is not taken for a local edit
          write(action.value);
          apply(action.value);
        } else if (action.kind === "none" && mine && mine === theirs) write(mine);
      };
      settle(tz, local, data.timezone ?? null, (v) => writeTimezoneSync(user.id, { synced: v, dirty: false }), updateTimezone);
      settle(lng, localLang, data.locale ?? null, (v) => writeLocaleSync(user.id, { synced: v, dirty: false }), (v) => setLanguage(v === "en" ? "en" : "ru"));
    } catch {
      // no network: the next exchange tries again
    } finally {
      running.current = false;
    }
  }, [ready, user, cloudActive, local, localLang, updateTimezone, setLanguage]);

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
    if (readTimezoneSync(user.id).dirty || readLocaleSync(user.id).dirty) void exchange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, localLang, syncMode, ready]);

  return null;
}
