"use client";

import { useSyncExternalStore } from "react";

/**
 * One clock for the Market page (PR 1.1b). It ticks on every full second while the tab is visible; in a background
 * tab it stops (browsers slow or freeze timers anyway) and on return the time is taken again at once.
 *
 * Components subscribe at the resolution they need: the countdowns and rings every second, the rest of the page once
 * a minute (sessions and killzones open and close on whole minutes) — so the seconds re-render only the timers.
 */
export type Resolution = "second" | "minute";

const listeners: Record<Resolution, Set<() => void>> = { second: new Set(), minute: new Set() };
let current = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let attached = false;

const floorTo = (ms: number, step: number) => Math.floor(ms / step) * step;
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

function update(): void {
  const prev = current;
  current = Date.now();
  if (floorTo(prev, 1000) !== floorTo(current, 1000)) listeners.second.forEach((l) => l());
  if (floorTo(prev, 60_000) !== floorTo(current, 60_000)) listeners.minute.forEach((l) => l());
}

function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Next tick right after the next full second. */
function schedule(): void {
  stop();
  timer = setTimeout(() => {
    timer = null;
    update();
    if (visible()) schedule();
  }, 1000 - (Date.now() % 1000));
}

function onVisibility(): void {
  if (!visible()) return stop();
  update();
  schedule();
}

function onPageShow(): void {
  // iPhone: a page restored from the back-forward cache gets no visibilitychange
  update();
  if (visible()) schedule();
}

function subscribe(res: Resolution, listener: () => void): () => void {
  listeners[res].add(listener);
  if (!attached) {
    attached = true;
    current = Date.now();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    if (visible()) schedule();
  }
  return () => {
    listeners[res].delete(listener);
    if (listeners.second.size + listeners.minute.size === 0) {
      stop();
      attached = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    }
  };
}

const subscribers: Record<Resolution, (l: () => void) => () => void> = {
  second: (l) => subscribe("second", l),
  minute: (l) => subscribe("minute", l),
};
// a stable value between calls (React compares two reads); refreshed when the first component subscribes
const read = () => {
  if (!attached && current === 0) current = Date.now();
  return current;
};
const snapshots: Record<Resolution, () => number> = {
  second: () => floorTo(read(), 1000),
  minute: () => floorTo(read(), 60_000),
};
// No time on the server render (and on the first client render): 0 means «not yet»
const serverSnapshot = () => 0;

/** The current time, floored to the resolution; 0 before the browser takes over. */
export function useClock(res: Resolution): number {
  return useSyncExternalStore(subscribers[res], snapshots[res], serverSnapshot);
}
