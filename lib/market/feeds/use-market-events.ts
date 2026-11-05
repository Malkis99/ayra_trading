"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { EVENT_COLUMNS, type CalendarEvent } from "./calendar-view";

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
export function useMarketEvents(from: number, to: number): [EventsState, () => void] {
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
    let away = false;
    if (!cached) setState({ status: "loading" });
    const read = async () => {
      if (inFlight || !live) return;
      inFlight = true;
      try {
        const { data, error } = await client
      .from("market_events")
      .select(EVENT_COLUMNS)
      .gte("starts_at", new Date(from).toISOString())
      .lt("starts_at", new Date(to).toISOString())
      .order("starts_at", { ascending: true })
      .limit(500);
        if (!live) return;
        if (error) {
          setState({ status: "error" });
          return;
        }
        const events = (data ?? []) as unknown as CalendarEvent[];
        cache.set(key, events);
        setState({ status: "ready", events });
      } catch {
        if (live) setState({ status: "error" });
      } finally { inFlight = false; }
    };
    const leave = () => { away = true; };
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
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, from, to, attempt]);

  const retry = useCallback(() => {
    cache.delete(key);
    setAttempt((a) => a + 1);
  }, [key]);
  return [state, retry];
}
