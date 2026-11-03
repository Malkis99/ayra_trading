"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { EVENT_COLUMNS, type CalendarEvent } from "./calendar-view";

export type EventsState =
  | { status: "loading" }
  | { status: "unavailable" } // the site has no cloud (guest mode without Supabase)
  | { status: "error" }
  | { status: "ready"; events: CalendarEvent[] };

/** Read once per week and kept for this visit (switching days or weeks back and forth does not ask again). */
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
    const cached = cache.get(key);
    if (cached && attempt === 0) {
      setState({ status: "ready", events: cached });
      return;
    }
    const client = createSupabaseBrowserClient();
    if (!client) {
      setState({ status: "unavailable" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    client
      .from("market_events")
      .select(EVENT_COLUMNS)
      .gte("starts_at", new Date(from).toISOString())
      .lt("starts_at", new Date(to).toISOString())
      .order("starts_at", { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setState({ status: "error" });
          return;
        }
        const events = (data ?? []) as unknown as CalendarEvent[];
        cache.set(key, events);
        setState({ status: "ready", events });
      });
    return () => {
      live = false;
    };
  }, [key, from, to, attempt]);

  const retry = useCallback(() => {
    cache.delete(key);
    setAttempt((a) => a + 1);
  }, [key]);
  return [state, retry];
}
