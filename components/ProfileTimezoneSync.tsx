"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { decideTimezone, readTimezoneSync, writeTimezoneSync } from "@/lib/profile-timezone";
import { readSyncState } from "@/lib/journal/cloud/sync-state";

/**
 * Exchanges the account's time zone with the cloud profile (lib/profile-timezone.ts). Renders nothing.
 * Runs after every cloud exchange of the journal (so «Manual» waits for «Synchronise», like the journal) and, in
 * «Automatic», right after the zone is changed here. Only for a signed-in account with cloud sync on; guests never.
 */
export function ProfileTimezoneSync() {
  const { user, isSpaceReady } = useAuth();
  const { gameState, updateTimezone, isLoaded } = useGame();
  const { cloudActive, cloudStatus, syncMode } = useJournal();
  const local = gameState.profile.timezone || null;
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

  const exchange = useCallback(async () => {
    if (!ready || !user || !cloudActive || running.current) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    running.current = true;
    try {
      const { data, error } = await supabase.from("profiles").select("timezone, updated_at").eq("id", user.id).maybeSingle();
      if (error || !data) return;
      const st = readTimezoneSync(user.id);
      const action = decideTimezone(local, { timezone: data.timezone ?? null, updatedAt: data.updated_at ?? null }, st);
      if (action.kind === "push") {
        const { error: upErr } = await supabase.from("profiles").update({ timezone: action.value }).eq("id", user.id);
        if (!upErr) writeTimezoneSync(user.id, { synced: action.value, dirty: false });
      } else if (action.kind === "take") {
        // remember first, so the change below is not taken for a local edit
        writeTimezoneSync(user.id, { synced: action.value, dirty: false });
        updateTimezone(action.value);
      } else if (local && local === data.timezone) {
        writeTimezoneSync(user.id, { synced: local, dirty: false });
      }
    } catch {
      // no network: the next exchange tries again
    } finally {
      running.current = false;
    }
  }, [ready, user, cloudActive, local, updateTimezone]);

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

  // Automatic: a zone changed here goes up at once
  useEffect(() => {
    if (!ready || !user || syncMode !== "auto") return;
    const st = readTimezoneSync(user.id);
    if (st.dirty) void exchange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, syncMode, ready]);

  return null;
}
