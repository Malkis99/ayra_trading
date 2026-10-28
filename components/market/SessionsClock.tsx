"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Clock, Settings2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatDate, formatString } from "@/lib/i18n";
import { browserTimeZone, timeZoneLabel } from "@/lib/timezones";
import { AppStorage } from "@/lib/storage";
import { Button, Chip, Input, cn } from "@/components/ui";
import {
  DEFAULT_KILLZONES,
  NEW_YORK,
  SESSIONS,
  clockOf,
  dayBounds,
  instantOf,
  isForexOpen,
  isValidWindow,
  killzoneDefs,
  normalizeKillzones,
  splitDuration,
  wallAt,
  windowStatus,
  windowsInRange,
  type KillzoneId,
  type KillzoneSettings,
  type WindowDef,
} from "@/lib/market/sessions";

/** Killzone hours of this space (account or guest), on this device. */
const KILLZONES_KEY = "ayra_market_killzones";

function readKillzones(): KillzoneSettings {
  try {
    const raw = AppStorage.getItem(KILLZONES_KEY);
    return normalizeKillzones(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeKillzones(null);
  }
}

function writeKillzones(value: KillzoneSettings) {
  try {
    AppStorage.setItem(KILLZONES_KEY, JSON.stringify(value));
  } catch {
    // storage full or blocked: the hours still apply until the page is reloaded
  }
}

/** Next Sunday 17:00 in New York (the forex week opens) after `ms`. */
function nextForexOpen(ms: number): number {
  const w = wallAt(ms, NEW_YORK);
  const daysToSunday = (7 - w.wd) % 7;
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + daysToSunday));
  return instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 17, 0, NEW_YORK);
}

/**
 * Market → Overview: sessions (Tokyo, London, New York) and killzones of London and New York on the user's clock —
 * open now and until when, or when they open; the bar of the user's day. Only clocks, no market data.
 */
export function SessionsClock() {
  const { dict, lang } = useApp();
  const game = useOptionalGame();
  const t = dict.market.sessions;
  const zone = game?.gameState.profile.timezone || browserTimeZone();

  // No time on the server render: the clock starts in the browser (no hydration mismatch)
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [killzones, setKillzones] = useState<KillzoneSettings>(DEFAULT_KILLZONES);
  useEffect(() => setKillzones(readKillzones()), []);
  const [editing, setEditing] = useState(false);

  const kzDefs = useMemo(() => killzoneDefs(killzones), [killzones]);

  const left = (ms: number) => {
    const { d, h, m } = splitDuration(ms);
    const parts = [d ? formatString(t.duration.d, { n: d }) : "", h ? formatString(t.duration.h, { n: h }) : "", d ? "" : formatString(t.duration.m, { n: m })];
    return parts.filter(Boolean).join(" ");
  };

  if (now === null) {
    return <section className="card min-h-[280px]" data-testid="market-sessions" aria-busy="true" />;
  }

  const { from, to } = dayBounds(now, zone);
  const span = to - from;
  const pct = (ms: number) => ((ms - from) / span) * 100;
  const isWeekend = !isForexOpen(now);

  const row = (def: WindowDef) => {
    const status = windowStatus(def, now);
    const today = windowsInRange(def, from, to);
    const name = t.names[def.id];
    const hours = today.length ? today.map((o) => `${clockOf(o.start, zone)}–${o.end === to ? "24:00" : clockOf(o.end, zone)}`).join(", ") : t.notToday;
    const statusText =
      status.state === "open"
        ? formatString(t.openUntil, { left: left(status.end - now) })
        : status.next
          ? formatString(t.opensIn, { left: left(status.next.start - now) })
          : "";
    return (
      <li key={def.id} className="space-y-1.5" data-testid={`market-window-${def.id}`} data-state={status.state}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-tx">{name}</span>
            <span className="text-xs tabular-nums text-mu" data-testid={`market-window-${def.id}-hours`}>
              {hours}
            </span>
          </div>
          {statusText && (
            <Chip tone={status.state === "open" ? "accent" : "neutral"} data-testid={`market-window-${def.id}-status`}>
              {statusText}
            </Chip>
          )}
        </div>
        <div className="relative h-3 overflow-hidden rounded-full border border-line bg-s2" aria-hidden="true">
          {today.map((o) => (
            <span
              key={o.start}
              className={cn("absolute inset-y-0 rounded-full", def.kind === "killzone" ? "bg-vi/70" : "bg-pri/80", status.state === "open" && "ring-1 ring-inset ring-vi")}
              style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }}
            />
          ))}
          <span className="absolute inset-y-0 w-0.5 bg-tx" style={{ left: `${pct(now)}%` }} />
        </div>
      </li>
    );
  };

  return (
    <section className="card space-y-4" data-testid="market-sessions" aria-labelledby="market-sessions-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="market-sessions-title" className="h4 flex items-center gap-2">
            <Clock size={18} className="text-vi" aria-hidden="true" />
            <span>{t.title}</span>
          </h2>
          <p className="mt-1 text-xs text-mu" data-testid="market-sessions-now">
            {formatString(t.yourTime, { time: clockOf(now, zone), zone: timeZoneLabel(zone, lang, new Date(now)) })}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-controls="market-killzones-settings" data-testid="market-killzones-edit">
          <Settings2 size={14} aria-hidden="true" />
          <span>{editing ? t.settings.close : t.settings.open}</span>
        </Button>
      </div>

      {isWeekend && (
        <p className="rounded-md border border-line bg-s2 px-3 py-2 text-xs text-tx" role="status" data-testid="market-weekend">
          {formatString(t.weekend, {
            local: formatDate(lang, nextForexOpen(now), { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
          })}
        </p>
      )}

      {editing && <KillzoneSettingsForm id="market-killzones-settings" value={killzones} zone={zone} now={now} onChange={(v) => { setKillzones(v); writeKillzones(v); }} />}

      <div className="space-y-1">
        <p className="text-xs text-mu">{t.dayBar}</p>
        <div className="flex justify-between text-[11px] tabular-nums text-mu" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.sessionsGroup}</h3>
        <ul className="space-y-3">{SESSIONS.map(row)}</ul>
      </div>
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.killzonesGroup}</h3>
        <ul className="space-y-3">{kzDefs.map(row)}</ul>
      </div>

      <p className="text-[11px] text-mu">{t.conventions}</p>
    </section>
  );
}

/** Killzone hours in New York time, with the user's local hours shown next to them. */
function KillzoneSettingsForm({
  id,
  value,
  zone,
  now,
  onChange,
}: {
  id: string;
  value: KillzoneSettings;
  zone: string;
  now: number;
  onChange: (v: KillzoneSettings) => void;
}) {
  const { dict } = useApp();
  const t = dict.market.sessions;
  // drafts: an invalid pair is shown with its error and not saved
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const set = (kz: KillzoneId, field: "start" | "end", v: string) => {
    const next = { ...draft, [kz]: { ...draft[kz], [field]: v } };
    setDraft(next);
    if (isValidWindow(next[kz].start, next[kz].end)) onChange({ ...value, [kz]: next[kz] });
  };

  const today = wallAt(now, NEW_YORK);
  const local = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return clockOf(instantOf(today.y, today.mo, today.d, h, m, NEW_YORK), zone);
  };

  return (
    <div id={id} className="space-y-3 rounded-md border border-line bg-s2/60 p-3" data-testid="market-killzones-form">
      <p className="text-xs text-mu">{t.settings.hint}</p>
      {(["londonKz", "newyorkKz"] as const).map((kz) => {
        const ok = isValidWindow(draft[kz].start, draft[kz].end);
        return (
          <fieldset key={kz} className="space-y-2">
            <legend className="text-sm font-semibold text-tx">{t.names[kz]}</legend>
            <div className="grid grid-cols-2 gap-2">
              <Input type="time" label={t.settings.start} value={draft[kz].start} onChange={(e) => set(kz, "start", e.target.value)} data-testid={`market-${kz}-start`} />
              <Input type="time" label={t.settings.end} value={draft[kz].end} onChange={(e) => set(kz, "end", e.target.value)} data-testid={`market-${kz}-end`} />
            </div>
            <p className={cn("text-xs", ok ? "text-mu" : "text-rose-300")} role={ok ? undefined : "alert"} data-testid={`market-${kz}-local`}>
              {ok ? formatString(t.settings.local, { from: local(draft[kz].start), to: local(draft[kz].end) }) : t.settings.invalid}
            </p>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-mu">{t.settings.saved}</span>
        <Button variant="ghost" onClick={() => onChange(normalizeKillzones(null))} data-testid="market-killzones-reset">
          {t.settings.reset}
        </Button>
      </div>
    </div>
  );
}
