"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { useClock } from "@/lib/market/live-clock";
import { countdown, progressOf, splitDuration } from "@/lib/market/sessions";

/**
 * A countdown to `to` that ticks every second. Only this element re-renders with the seconds (the page around it
 * follows the minute clock). «clock»: 07:29:59 / 1 д 20:00:00; «human»: 1 ч 20 мин.
 */
export function Countdown({ to, format = "clock", className, "data-testid": testId }: { to: number; format?: "clock" | "human"; className?: string; "data-testid"?: string }) {
  const { dict } = useApp();
  const t = dict.market.sessions;
  const now = useClock("second");
  if (!now) return null;
  const left = to - now;
  let text: string;
  if (format === "clock") {
    const { d, hms } = countdown(left);
    text = d ? formatString(t.days, { d, hms }) : hms;
  } else {
    const { d, h, m } = splitDuration(left);
    text = [d ? formatString(t.duration.d, { n: d }) : "", h ? formatString(t.duration.h, { n: h }) : "", !d && (m || !h) ? formatString(t.duration.m, { n: m }) : ""].filter(Boolean).join(" ");
  }
  return (
    <span className={className} role="timer" aria-live="off" data-testid={testId}>
      {text}
    </span>
  );
}

/** How much of the session has passed: a ring that fills during the session; empty while it is closed. */
export function ProgressRing({ start, end, open, children, "data-testid": testId }: { start: number; end: number; open: boolean; children?: React.ReactNode; "data-testid"?: string }) {
  const { dict } = useApp();
  const now = useClock("second");
  const p = open && now ? progressOf({ id: "london", start, end }, now) : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  const percent = Math.floor(p * 100);
  return (
    <div
      className="relative grid h-16 w-16 shrink-0 place-items-center"
      role={open ? "progressbar" : undefined}
      aria-valuemin={open ? 0 : undefined}
      aria-valuemax={open ? 100 : undefined}
      aria-valuenow={open ? percent : undefined}
      aria-label={open ? formatString(dict.market.sessions.progress, { p: percent }) : undefined}
      data-testid={testId}
      data-progress={percent}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-s2" />
        {open && <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-vi" strokeDasharray={`${c * p} ${c}`} />}
      </svg>
      <span className="relative text-vi">{children}</span>
    </div>
  );
}
