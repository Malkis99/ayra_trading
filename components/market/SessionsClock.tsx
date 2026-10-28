"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, CircleDot, Clock, HelpCircle, Moon, Settings2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatDate, formatString } from "@/lib/i18n";
import { browserTimeZone, timeZoneLabel } from "@/lib/timezones";
import { Button, cn } from "@/components/ui";
import { SettingRow } from "@/components/ui/SettingRow";
import { useClock } from "@/lib/market/live-clock";
import { useMarketSettings } from "@/lib/market/settings-store";
import { Countdown, ProgressRing } from "./LiveTimer";
import { DayTimeline } from "./DayTimeline";
import { DisplayZonePicker } from "./DisplayZonePicker";
import { SessionsSettings } from "./SessionsSettings";
import {
  ALL_SESSIONS,
  MAIN_SESSIONS,
  SUB_SESSIONS,
  clockOf,
  currentOrNext,
  dayOffset,
  displayZoneOf,
  gapBackToUsual,
  hoursOf,
  isForexOpen,
  killzoneDefs,
  londonNewYorkGapHours,
  londonNewYorkOverlap,
  nextForexOpen,
  occurrences,
  sessionDefs,
  statusFromList,
  upcomingEvents,
  type MainSessionId,
  type Occurrence,
  type SessionGroup,
  type StatusId,
  type SubSessionId,
  type WindowDef,
} from "@/lib/market/sessions";

type State = "open" | "closed" | "weekend";

/** Status in words with an icon: the colour is never the only sign. */
function StatusBadge({ state, testId }: { state: State; testId: string }) {
  const { dict } = useApp();
  const s = dict.market.sessions.status;
  const Icon = state === "open" ? CircleDot : state === "weekend" ? Moon : Clock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        state === "open" ? "border-vi/50 bg-pri/25 text-tx" : "border-line bg-s2 text-mu"
      )}
      data-testid={testId}
    >
      <Icon size={13} aria-hidden="true" />
      {s[state]}
    </span>
  );
}

/**
 * «?» with a short description of the session: opens on tap (phones) or click, Esc closes. The text sits under the
 * row at full width (the parent wraps), so it never covers anything.
 */
function AboutHint({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        data-testid={`${testId}-hint`}
      >
        <HelpCircle size={16} aria-hidden="true" />
      </button>
      {/* a display class would override `hidden`: shown only while open */}
      <span id={id} hidden={!open} className={cn(open ? "block" : "hidden", "basis-full rounded-lg border border-line bg-s1/80 p-2.5 text-[11px] leading-snug text-mu")} data-testid={`${testId}-about`}>
        {text}
      </span>
    </>
  );
}

/**
 * Market → Overview: the three main sessions (Asia / Tokyo, London, New York) as cards with live countdowns, the
 * London and New York killzones inside their cards, the London + New York overlap, the sub-sessions (Sydney,
 * Wellington, Hong Kong, Frankfurt, Chicago) as a compact list, «What is next», the 24-hour bar under «Show 24 h».
 *
 * Everything is shown in the display time (New York by default; my zone, UTC or any zone). The page follows the
 * minute clock; only the countdowns and the rings tick every second (`LiveTimer`).
 */
export function SessionsClock() {
  const { dict, lang } = useApp();
  const game = useOptionalGame();
  const t = dict.market.sessions;
  const profileZone = game?.gameState.profile.timezone || browserTimeZone();
  const [settings, setSettings] = useMarketSettings();
  const zone = displayZoneOf(settings.display, profileZone);
  const showMine = zone !== profileZone;
  const now = useClock("minute");
  const [editing, setEditing] = useState(false);
  const [showDay, setShowDay] = useState(false);

  const defs = useMemo(() => sessionDefs(settings.sessions), [settings.sessions]);
  const kzDefs = useMemo(() => killzoneDefs(settings.killzones), [settings.killzones]);

  const data = useMemo(() => {
    if (!now) return null;
    const lists = new Map<StatusId, Occurrence[]>();
    for (const id of ALL_SESSIONS) lists.set(id, occurrences(defs[id], now));
    for (const d of kzDefs) lists.set(d.id, occurrences(d, now));
    lists.set("overlap", londonNewYorkOverlap(now, 8, defs.london, defs.newyork));
    return { lists, events: upcomingEvents([...ALL_SESSIONS.map((id) => defs[id]), ...kzDefs], now, 5) };
  }, [now, defs, kzDefs]);

  if (!now || !data) {
    return <section className="card min-h-[320px]" data-testid="market-sessions" aria-busy="true" />;
  }

  const weekend = !isForexOpen(now);
  const listOf = (id: StatusId) => data.lists.get(id) ?? [];
  const stateOf = (id: StatusId): State => (statusFromList(id, listOf(id), now).state === "open" ? "open" : weekend ? "weekend" : "closed");
  const nameOf = (id: StatusId) => t.names[id];

  const dayWord = (ms: number) => {
    const off = dayOffset(ms, now, zone);
    if (off < 0) return t.yesterday;
    if (off === 0) return t.today;
    if (off === 1) return t.tomorrow;
    return formatDate(lang, ms, { timeZone: zone, weekday: "short" });
  };

  /** «Closes in 07:29:59» / «Opens in 03:29:59» for one window. */
  const countdownOf = (id: StatusId, big: boolean) => {
    const status = statusFromList(id, listOf(id), now);
    const target = status.state === "open" ? status.end : status.next?.start;
    if (target === undefined) return null;
    return (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-mu">{status.state === "open" ? t.status.closesIn : t.status.opensIn}</span>
        <Countdown to={target} className={cn("font-mono tabular-nums text-tx", big ? "text-2xl font-semibold" : "text-sm font-semibold")} data-testid={`market-${id}-timer`} />
      </span>
    );
  };

  const hoursLine = (id: StatusId) => {
    const occ = currentOrNext(listOf(id), now);
    return occ ? `${dayWord(occ.start)} · ${hoursOf(occ, zone)}` : "";
  };
  /** «Your time: 11:00–20:00» when the display time is not the profile's zone. */
  const mine = (id: StatusId) => {
    const occ = currentOrNext(listOf(id), now);
    if (!showMine || !occ) return null;
    return (
      <span className="block basis-full text-[11px] tabular-nums text-mu" data-testid={`market-${id}-mine`}>
        {formatString(t.myTime, { hours: hoursOf(occ, profileZone) })}
      </span>
    );
  };
  const aboutOf = (group: SessionGroup | "overlap") => t.about[group];
  const hintLabel = (id: StatusId) => `${dict.journalSettings.hintLabel}: ${nameOf(id)}`;

  const killzoneOf: Partial<Record<StatusId, WindowDef>> = { london: kzDefs[0], newyork: kzDefs[1] };

  const card = (id: MainSessionId) => {
    const state = stateOf(id);
    const occ = currentOrNext(listOf(id), now);
    const kz = killzoneOf[id];
    const group = defs[id].group as SessionGroup;
    return (
      <li
        key={id}
        className={cn("flex flex-col gap-3 rounded-lg border p-4", state === "open" ? "border-vi/60 bg-pri/10" : "border-line bg-s2/30")}
        data-testid={`market-card-${id}`}
        data-state={state}
      >
        <div className="flex items-start gap-3">
          <ProgressRing start={occ?.start ?? 0} end={occ?.end ?? 1} open={state === "open"} data-testid={`market-${id}-ring`}>
            {state === "open" ? <CircleDot size={18} aria-hidden="true" /> : state === "weekend" ? <Moon size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
          </ProgressRing>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <h3 className="font-serif text-lg font-bold text-tx">{nameOf(id)}</h3>
              <StatusBadge state={state} testId={`market-${id}-status`} />
            </div>
            {countdownOf(id, true)}
            <p className="text-xs tabular-nums text-mu" data-testid={`market-${id}-hours`}>
              {hoursLine(id)}
            </p>
            <div className="flex flex-wrap items-center">
              {mine(id)}
              <span className="text-[11px] text-mu">{t.groups[group]}</span>
              <AboutHint text={aboutOf(group)} label={hintLabel(id)} testId={`market-${id}`} />
            </div>
          </div>
        </div>
        {kz && (
          <div className="space-y-1 border-t border-line pt-3" data-testid={`market-card-${kz.id}`} data-state={stateOf(kz.id)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-tx">
                {t.killzone}{" "}
                <span className="text-xs font-normal tabular-nums text-mu" data-testid={`market-${kz.id}-hours`}>
                  {hoursLine(kz.id)}
                </span>
              </span>
              <StatusBadge state={stateOf(kz.id)} testId={`market-${kz.id}-status`} />
            </div>
            {countdownOf(kz.id, false)}
            {mine(kz.id)}
          </div>
        )}
      </li>
    );
  };

  const subRow = (id: SubSessionId) => {
    const group = defs[id].group as SessionGroup;
    return (
      <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`market-sub-${id}`} data-state={stateOf(id)}>
        <span className="min-w-[9rem]">
          <span className="text-sm font-semibold text-tx">{nameOf(id)}</span>
          <span className="ml-1 text-[11px] text-mu">· {t.groups[group]}</span>
        </span>
        <span className="text-xs tabular-nums text-mu" data-testid={`market-${id}-hours`}>
          {hoursLine(id)}
        </span>
        <StatusBadge state={stateOf(id)} testId={`market-${id}-status`} />
        {countdownOf(id, false)}
        <span className="ml-auto">
          <AboutHint text={aboutOf(group)} label={hintLabel(id)} testId={`market-${id}`} />
        </span>
        {mine(id)}
      </li>
    );
  };

  const eventText = (e: (typeof data.events)[number]) => {
    const name = nameOf(e.id);
    if (e.kind === "session") return formatString(e.edge === "start" ? t.next.sessionOpen : t.next.sessionClose, { name });
    return formatString(e.edge === "start" ? t.next.kzStart : t.next.kzEnd, { name });
  };

  const gapHours = londonNewYorkGapHours(now);
  const gapUntil = gapBackToUsual(now);
  const active = ([...ALL_SESSIONS, "londonKz", "newyorkKz", "overlap"] as StatusId[]).filter((id) => stateOf(id) === "open").map(nameOf);

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
        <Button variant="secondary" onClick={() => setEditing(true)} aria-haspopup="dialog" data-testid="market-settings-open">
          <Settings2 size={14} aria-hidden="true" />
          <span>{t.settings.open}</span>
        </Button>
      </div>

      <DisplayZonePicker idPrefix="market" value={settings.display} profileZone={profileZone} onChange={(display) => setSettings({ ...settings, display })} />

      <p className="text-sm font-semibold text-tx" data-testid="market-active-now">
        {active.length ? formatString(t.activeNow, { list: active.join(", ") }) : weekend ? t.activeWeekend : t.activeNone}
      </p>

      <ul className="grid gap-3 lg:grid-cols-3">{MAIN_SESSIONS.map(card)}</ul>

      {/* London + New York overlap: one line */}
      <div
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3", stateOf("overlap") === "open" ? "border-vi/60 bg-pri/10" : "border-line bg-s2/30")}
        data-testid="market-card-overlap"
        data-state={stateOf("overlap")}
      >
        <span className="text-sm font-semibold text-tx">{nameOf("overlap")}</span>
        <StatusBadge state={stateOf("overlap")} testId="market-overlap-status" />
        {countdownOf("overlap", false)}
        <span className="text-xs tabular-nums text-mu" data-testid="market-overlap-hours">
          {hoursLine("overlap")}
        </span>
        <span className="ml-auto">
          <AboutHint text={aboutOf("overlap")} label={hintLabel("overlap")} testId="market-overlap" />
        </span>
        {mine("overlap")}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.subTitle}</h3>
        <ul className="divide-y divide-line rounded-lg border border-line" data-testid="market-subsessions">
          {SUB_SESSIONS.map(subRow)}
        </ul>
        <p className="text-[11px] text-mu" data-testid="market-about-note">
          {t.aboutNote}
        </p>
      </div>

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

      <div className="space-y-2" data-testid="market-next">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.next.title}</h3>
        {weekend && (
          <p className="rounded-md border border-line bg-s2 px-3 py-2 text-xs text-tx" role="status" data-testid="market-weekend">
            {formatString(t.next.weekend, {
              local: formatDate(lang, nextForexOpen(now), { timeZone: zone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
            })}
          </p>
        )}
        <ol className="divide-y divide-line rounded-lg border border-line">
          {data.events.map((e) => (
            <li key={`${e.id}-${e.edge}-${e.at}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2" data-testid="market-next-item">
              <span className="text-sm text-tx">{eventText(e)}</span>
              <span className="text-xs tabular-nums text-mu">
                {dayWord(e.at)} {clockOf(e.at, zone)} · {formatString(t.next.in, { left: "" }).trim()}{" "}
                <Countdown to={e.at} format="human" className="font-semibold text-tx" />
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3">
        <Button variant="ghost" onClick={() => setShowDay((v) => !v)} aria-expanded={showDay} aria-controls="market-day" data-testid="market-day-toggle">
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", showDay && "rotate-180")} />
          <span>{showDay ? t.day.hide : t.day.show}</span>
        </Button>
        {showDay && (
          <div id="market-day">
            <DayTimeline now={now} zone={zone} sessions={MAIN_SESSIONS.map((id) => defs[id])} killzones={kzDefs} />
          </div>
        )}
      </div>

      <p className="text-[11px] text-mu">{t.conventions}</p>

      <SessionsSettings open={editing} onClose={() => setEditing(false)} value={settings} onChange={setSettings} displayZone={zone} profileZone={profileZone} now={now} />
    </section>
  );
}
