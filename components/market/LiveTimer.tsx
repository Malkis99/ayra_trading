"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { useClock } from "@/lib/market/live-clock";
import { cn } from "@/components/ui";
import { progressOf, splitDuration } from "@/lib/market/sessions";

const DAY_SECONDS = 86_400;
type DurationWords = { d: string; h: string; m: string };

/**
 * The text of a countdown (PR 1.1d), one format everywhere:
 * - «clock» (the main cards): up to a day «HH:MM:SS», longer «1 д 0 ч 52 мин» (no seconds);
 * - «human» (killzones, the table, «What is next»): «1 д 0 ч 52 мин», «7 ч 33 мин», «30 мин».
 */
export function countdownText(ms: number, format: "clock" | "human", words: DurationWords): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (format === "clock" && seconds <= DAY_SECONDS) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  }
  // «clock» drops the seconds of HH:MM:SS (24:52:21 → 1 д 0 ч 52 мин); «human» rounds up, as before
  const { d, h, m } = format === "clock" ? splitDuration(Math.floor(seconds / 60) * 60_000) : splitDuration(ms);
  const parts: string[] = [];
  if (d) parts.push(formatString(words.d, { n: d }));
  if (d || h) parts.push(formatString(words.h, { n: h }));
  parts.push(formatString(words.m, { n: m }));
  return parts.join(" ");
}

/** More than a day left: the long form, which needs a smaller font inside the ring. */
export const isLongCountdown = (ms: number) => Math.ceil(ms / 1000) > DAY_SECONDS;

/**
 * A countdown to `to` that ticks every second. Only this element re-renders with the seconds (the page around it
 * follows the minute clock). Never wraps; digits keep their width.
 */
export function Countdown({
  to,
  format = "clock",
  className,
  longClassName,
  "data-testid": testId,
}: {
  to: number;
  format?: "clock" | "human";
  className?: string;
  /** Used instead of `className` when more than a day is left. */
  longClassName?: string;
  "data-testid"?: string;
}) {
  const { dict } = useApp();
  const now = useClock("second");
  if (!now) return null;
  const left = to - now;
  const long = isLongCountdown(left);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", long && longClassName ? longClassName : className)} role="timer" aria-live="off" data-testid={testId} data-long={long || undefined}>
      {countdownText(left, format, dict.market.sessions.duration)}
    </span>
  );
}

/** How much of the session has passed: a ring that fills during the session; empty while it is closed. */
export function ProgressRing({
  start,
  end,
  open,
  size = 64,
  stroke = 6,
  children,
  "data-testid": testId,
}: {
  start: number;
  end: number;
  open: boolean;
  size?: number;
  /** Line width in the ring's own 64-unit box. */
  stroke?: number;
  children?: React.ReactNode;
  "data-testid"?: string;
}) {
  const { dict } = useApp();
  const now = useClock("second");
  const p = open && now ? progressOf({ id: "london", start, end }, now) : 0;
  const r = 32 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const percent = Math.floor(p * 100);
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role={open ? "progressbar" : undefined}
      aria-valuemin={open ? 0 : undefined}
      aria-valuemax={open ? 100 : undefined}
      aria-valuenow={open ? percent : undefined}
      aria-label={open ? formatString(dict.market.sessions.progress, { p: percent }) : undefined}
      data-testid={testId}
      data-progress={percent}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth={stroke} className="stroke-s2" />
        {open && <circle cx="32" cy="32" r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="stroke-vi" strokeDasharray={`${c * p} ${c}`} />}
      </svg>
      <span className="relative text-vi">{children}</span>
    </div>
  );
}
