"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Clock, Settings2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatDate, formatString } from "@/lib/i18n";
import { browserTimeZone, timeZoneLabel } from "@/lib/timezones";
import { AppStorage } from "@/lib/storage";
import { Button, Chip, Input, cn } from "@/components/ui";
import { SettingRow } from "@/components/ui/SettingRow";
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
  gapBackToUsual,
  intervalLabel,
  londonNewYorkGapHours,
  londonNewYorkOverlap,
  occurrences,
  primaryOccurrence,
  splitDuration,
  statusFromList,
  wallAt,
  type KillzoneId,
  type KillzoneSettings,
  type Occurrence,
  type StatusId,
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
    const parts = [d ? formatString(t.duration.d, { n: d }) : "", h ? formatString(t.duration.h, { n: h }) : "", !d && (m || !h) ? formatString(t.duration.m, { n: m }) : ""];
    return parts.filter(Boolean).join(" ");
  };

  if (now === null) {
    return <section className="card min-h-[280px]" data-testid="market-sessions" aria-busy="true" />;
  }

  const { from, to } = dayBounds(now, zone);
  const span = to - from;
  const pct = (ms: number) => ((ms - from) / span) * 100;
  const clip = (list: Occurrence[]) => list.filter((o) => o.end > from && o.start < to).map((o) => ({ ...o, start: Math.max(o.start, from), end: Math.min(o.end, to) }));
  const isWeekend = !isForexOpen(now);

  type Row = { id: StatusId; name: string; kind: "session" | "killzone" | "overlap"; list: Occurrence[] };
  const overlap = londonNewYorkOverlap(now);
  const sessionRows: Row[] = [
    ...SESSIONS.map((d) => ({ id: d.id, name: t.names[d.id], kind: "session" as const, list: occurrences(d, now) })),
    { id: "overlap", name: t.names.overlap, kind: "overlap", list: overlap },
  ];
  const killzoneRows: Row[] = kzDefs.map((d) => ({ id: d.id, name: t.names[d.id], kind: "killzone" as const, list: occurrences(d, now) }));
  const statuses = new Map([...sessionRows, ...killzoneRows].map((r) => [r.id, statusFromList(r.id, r.list, now)]));
  const active = [...sessionRows, ...killzoneRows].filter((r) => statuses.get(r.id)?.state === "open").map((r) => r.name);

  const gapHours = londonNewYorkGapHours(now);
  const gapUntil = gapBackToUsual(now);

  const row = (r: Row) => {
    const status = statuses.get(r.id)!;
    const primary = primaryOccurrence(r.list, from, to);
    const hours = primary ? intervalLabel(primary, zone, from, to) : t.notToday;
    const statusText =
      status.state === "open"
        ? formatString(t.openUntil, { left: left(status.end - now) })
        : status.next
          ? formatString(t.opensIn, { left: left(status.next.start - now) })
          : "";
    // London and New York tracks show where they overlap
    const overlay = r.id === "london" || r.id === "newyork" ? clip(overlap) : [];
    return (
      <li key={r.id} className="space-y-1.5" data-testid={`market-window-${r.id}`} data-state={status.state}>
        {/* above the «now» line: the line passes behind the texts */}
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-sm font-semibold", r.kind === "overlap" ? "text-vi" : "text-tx")}>{r.name}</span>
            <span className="text-xs tabular-nums text-mu" data-testid={`market-window-${r.id}-hours`}>
              {hours}
            </span>
          </div>
          {statusText && (
            <span className="rounded-full bg-s1">
              <Chip tone={status.state === "open" ? "accent" : "neutral"} data-testid={`market-window-${r.id}-status`}>
                {statusText}
              </Chip>
            </span>
          )}
        </div>
        <div className="relative h-3 overflow-hidden rounded-full border border-line bg-s2" aria-hidden="true">
          {clip(r.list).map((o) => (
            <span
              key={o.start}
              className={cn(
                "absolute inset-y-0 rounded-full",
                r.kind === "killzone" ? "bg-vi/60" : r.kind === "overlap" ? "bg-vi" : "bg-pri/80",
                status.state === "open" && "ring-1 ring-inset ring-tx/70"
              )}
              style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }}
            />
          ))}
          {overlay.map((o) => (
            <span key={`ov-${o.start}`} className="absolute inset-y-0 bg-vi/70" style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }} />
          ))}
        </div>
      </li>
    );
  };

  const nowPct = pct(now);
  const nowClock = clockOf(now, zone);

  return (
    <section className="card space-y-4" data-testid="market-sessions" aria-labelledby="market-sessions-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="market-sessions-title" className="h4 flex items-center gap-2">
            <Clock size={18} className="text-vi" aria-hidden="true" />
            <span>{t.title}</span>
          </h2>
          <p className="mt-1 text-xs text-mu" data-testid="market-sessions-now">
            {formatString(t.yourTime, { time: nowClock, zone: timeZoneLabel(zone, lang, new Date(now)) })}
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

      <p className="text-sm font-semibold text-tx" data-testid="market-active-now">
        {active.length ? formatString(t.activeNow, { list: active.join(", ") }) : isWeekend ? t.activeWeekend : t.activeNone}
      </p>

      {gapHours !== 5 && (
        <SettingRow
          title={formatString(t.gap.title, { h: gapHours })}
          hint={
            gapUntil
              ? formatString(t.gap.hint, { h: gapHours, date: formatDate(lang, gapUntil, { timeZone: zone, day: "numeric", month: "long" }) })
              : formatString(t.gap.hintNoDate, { h: gapHours })
          }
          hintLabel={dict.journalSettings.hintLabel}
          data-testid="market-gap"
        >
          {null}
        </SettingRow>
      )}

      {/* One timeline: hour marks, the «now» line through every row */}
      <div className="relative" data-testid="market-timeline">
        <p className="mb-1 text-xs text-mu">{t.dayBar}</p>
        <div className="relative h-6">
          <span
            className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-tx px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
            style={{ left: `${Math.min(92, Math.max(8, nowPct))}%` }}
            data-testid="market-now-mark"
          >
            {formatString(t.nowMark, { time: nowClock })}
          </span>
        </div>
        <div className="relative mb-2 h-4 text-[11px] tabular-nums text-mu" aria-hidden="true">
          {["00", "06", "12", "18", "24"].map((h, i) => (
            <span key={h} className={cn("absolute top-0", i === 0 ? "" : i === 4 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${i * 25}%` }}>
              {h}
            </span>
          ))}
        </div>

        <div className="relative space-y-4">
          {/* hour grid and the «now» line under the labels, over the tracks */}
          {[25, 50, 75].map((p) => (
            <span key={p} aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-line/70" style={{ left: `${p}%` }} />
          ))}
          <span aria-hidden="true" className="pointer-events-none absolute -top-6 bottom-0 z-10 w-0.5 -translate-x-1/2 bg-tx/90" style={{ left: `${nowPct}%` }} data-testid="market-now-line" />

          <div className="space-y-3">
            <h3 className="relative z-20 text-xs font-semibold uppercase tracking-wide text-mu">{t.sessionsGroup}</h3>
            <ul className="space-y-3">{sessionRows.map(row)}</ul>
            <p className="relative z-20 text-[11px] text-mu">{t.overlapHint}</p>
          </div>
          <div className="space-y-3">
            <h3 className="relative z-20 text-xs font-semibold uppercase tracking-wide text-mu">{t.killzonesGroup}</h3>
            <ul className="space-y-3">{killzoneRows.map(row)}</ul>
          </div>
        </div>
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
