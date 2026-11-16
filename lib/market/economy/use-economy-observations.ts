"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { economyCodes, economyColumns, projectEconomy, type EconomyCalendarRow } from "./project-calendar";

type Data = ReturnType<typeof projectEconomy>;
type State = { status: "loading" | "unavailable" | "error" | "ready"; data?: Data };
let cache: Data | undefined;
let pending: Promise<Data> | undefined;

async function read(client: NonNullable<ReturnType<typeof createSupabaseBrowserClient>>) {
  const now = Date.now();
  const { data, error } = await client.from("market_events").select(economyColumns)
    .eq("country", "us").eq("kind", "release").eq("status", "released").eq("hidden", false)
    .in("code", economyCodes).not("actual", "is", null)
    .lte("starts_at", new Date(now).toISOString())
    .gte("starts_at", new Date(now - 90 * 86_400_000).toISOString())
    .order("starts_at", { ascending: false }).limit(100);
  if (error) throw error;
  return projectEconomy((data ?? []) as unknown as EconomyCalendarRow[], now);
}

export function useEconomyObservations() {
  const [state, setState] = useState<State>(() => cache ? { status: "ready", data: cache } : { status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const client = createSupabaseBrowserClient();
    if (!client) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    const refresh = () => {
      pending ??= read(client).then(data => (cache = data)).finally(() => { pending = undefined; });
      void pending.then(data => {
        if (active) setState({ status: "ready", data });
      }, () => {
        if (active) setState({ status: "error", data: cache });
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [attempt]);
  return { ...state, retry: () => {
    setState({ status: "loading", data: cache });
    setAttempt(current => current + 1);
  } };
}
