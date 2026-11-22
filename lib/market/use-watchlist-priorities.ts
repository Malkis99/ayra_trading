"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { AppStorage } from "@/lib/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isE2EMockEnabled } from "@/lib/supabase/config";
import { PriorityQueue, type PriorityAccount } from "./priority-queue";
import { BrowserPriorityStore, PRIORITY_EVENT, prioritySignalKey } from "@/lib/storage/watchlist-priorities";
import { SupabaseWatchlistMetaRemote } from "./watchlist-meta-sync";
import { captureMarketAccount } from "./account-scope";
import { spaceTabChannel } from "@/lib/auth/space-channel";

export function useWatchlistPriorities(started = true) {
  const { user, isSpaceReady } = useAuth();
  const userId = isSpaceReady ? user?.id ?? null : null;
  const [state, setState] = useState<{ userId: string; record?: PriorityAccount; storageError?: boolean } | null>(null);
  const controller = useRef<PriorityQueue | null>(null);
  const generation = useRef(0);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => spaceTabChannel.subscribe(message => { if (message.fromSpaceId !== message.toSpaceId) setEpoch(value => value + 1); }), []);
  useEffect(() => {
    if (!started || !userId || isE2EMockEnabled()) return;
    const effectGeneration = ++generation.current;
    const store = new BrowserPriorityStore(), scope = captureMarketAccount(() => AppStorage.getUserId());
    let stopped = false;
    const queue = new PriorityQueue(userId, new SupabaseWatchlistMetaRemote(createSupabaseBrowserClient), store,
      () => !stopped && scope.current() ? AppStorage.getUserId() : null, () => navigator.onLine, () => crypto.randomUUID());
    controller.current = queue;
    const read = async () => {
      try { const record = await store.read(userId); if (!stopped && scope.current()) setState({ userId, record }); }
      catch { if (!stopped && scope.current()) setState({ userId, storageError: true }); }
    };
    const run = () => { void queue.run().catch(() => { if (!stopped && scope.current()) setState({ userId, storageError: true }); }); };
    const changed = (event: Event) => { if ((event as CustomEvent<{ userId: string }>).detail?.userId === userId) void read(); };
    // Cache notifications never trigger network feedback loops between tabs.
    const storage = (event: StorageEvent) => { if (event.key === prioritySignalKey(userId)) void read(); };
    const visible = () => { if (document.visibilityState === "visible") run(); };
    void read(); run();
    window.addEventListener(PRIORITY_EVENT, changed); window.addEventListener("storage", storage);
    window.addEventListener("online", run); window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 5 * 60 * 1000);
    return () => { stopped = true; generation.current = effectGeneration + 1; queue.dispose(); scope.dispose(); controller.current = null; clearInterval(timer);
      window.removeEventListener(PRIORITY_EVENT, changed); window.removeEventListener("storage", storage);
      window.removeEventListener("online", run); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [userId, epoch, started]);
  const renderedGeneration = generation.current;
  return { userId, record: state?.userId === userId ? state.record : undefined, storageError: state?.userId === userId && state.storageError,
    controller: controller.current, failed: () => { if (renderedGeneration === generation.current && userId && AppStorage.getUserId() === userId) setState({ userId, storageError: true }); } };
}
