"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { EVENT_COLUMNS, hasPendingRelease, nextReleaseRead, RELEASE_COLUMNS, type CalendarEvent } from "./calendar-view";

export type EventsState =
  | { status: "loading" }
  | { status: "unavailable" } // the site has no cloud (guest mode without Supabase)
  | { status: "error" }
  | { status: "ready"; events: CalendarEvent[] };

/** Cached content renders immediately; mounting/returning to the calendar refreshes only AYRA's own database. */
const cache = new Map<string, CalendarEvent[]>();

/**
 * The week's calendar events from the 0009 table (everyone may read; the collector fills it). `from`/`to` are the
 * user's Monday 00:00 and Saturday 00:00.
 */
export function useMarketEvents(from: number, to: number, refreshNearRelease = false): [EventsState, () => void] {
  const key = `${from}-${to}`;
  const [state, setState] = useState<EventsState>(() => (cache.has(key) ? { status: "ready", events: cache.get(key)! } : { status: "loading" }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!from || !to) return; // the week is not known yet (the clock starts on the device)
    const cached = cache.get(key);
    if (cached) setState({ status: "ready", events: cached });
    const client = createSupabaseBrowserClient();
    if (!client) {
      setState({ status: "unavailable" });
      return;
    }
    let live = true;
    let inFlight = false;
    let away = document.visibilityState === "hidden" || (refreshNearRelease && !document.hasFocus());
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = cached;
    const active = () => !away && document.visibilityState !== "hidden" && document.hasFocus();
    const schedule = () => {
      clearTimeout(timer);
      if (!refreshNearRelease || !live || !active() || !latest) return;
      const next = nextReleaseRead(latest, Date.now());
      if (next !== null) timer = setTimeout(() => {
        if (!active() || !latest) return;
        if (hasPendingRelease(latest, Date.now())) void read();
        else schedule();
      }, Math.max(0, next - Date.now()));
    };
    if (!cached) setState({ status: "loading" });
    const read = async () => {
      if (inFlight || !live) return;
      inFlight = true;
      try {
        const { data, error } = await client
          .from("market_events")
          .select(EVENT_COLUMNS + (process.env.NEXT_PUBLIC_MARKET_RELEASE_CHECKS === "1" ? RELEASE_COLUMNS : ""))
          .gte("starts_at", new Date(from).toISOString())
          .lt("starts_at", new Date(to).toISOString())
          .order("starts_at", { ascending: true })
          .limit(500);
        if (!live) return;
        if (error) {
          if (!latest) setState({ status: "error" });
          return;
        }
        const events = (data ?? []) as unknown as CalendarEvent[];
        latest = events;
        cache.set(key, events);
        setState({ status: "ready", events });
      } catch {
        if (live && !latest) setState({ status: "error" });
      } finally { inFlight = false; schedule(); }
    };
    const leave = () => { away = true; clearTimeout(timer); };
    const back = () => {
      if (document.visibilityState === "hidden" || !away) return;
      away = false;
      void read();
    };
    const visibility = () => { if (document.visibilityState === "hidden") leave(); else back(); };
    void read();
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, from, to, attempt, refreshNearRelease]);

  const retry = useCallback(() => {
    cache.delete(key);
    setAttempt((a) => a + 1);
  }, [key]);
  return [state, retry];
}
