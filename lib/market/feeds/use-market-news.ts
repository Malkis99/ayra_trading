"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { NEWS_COLUMNS, type NewsItem } from "./today";

export type NewsState = { status: "loading" } | { status: "unavailable" } | { status: "error" } | { status: "ready"; items: NewsItem[] };

const cache = new Map<string, NewsItem[]>();

/** Official news since `from` (ms), newest first, read from the 0009 table (hidden rows never come). */
export function useMarketNews(from: number, limit = 200): [NewsState, () => void] {
  const key = `${from}-${limit}`;
  const [state, setState] = useState<NewsState>(() => (cache.has(key) ? { status: "ready", items: cache.get(key)! } : { status: "loading" }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!from) return;
    const cached = cache.get(key);
    if (cached && attempt === 0) {
      setState({ status: "ready", items: cached });
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
      .from("market_news")
      .select(NEWS_COLUMNS)
      .gte("published_at", new Date(from).toISOString())
      .order("published_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setState({ status: "error" });
        const items = (data ?? []) as unknown as NewsItem[];
        cache.set(key, items);
        setState({ status: "ready", items });
      });
    return () => {
      live = false;
    };
  }, [key, from, limit, attempt]);

  const retry = useCallback(() => {
    cache.delete(key);
    setAttempt((a) => a + 1);
  }, [key]);
  return [state, retry];
}
