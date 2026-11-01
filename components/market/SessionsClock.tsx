"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, Clock, Settings2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatDate, formatString } from "@/lib/i18n";
import { browserTimeZone, timeZoneLabel, timeZoneOffsetLabel } from "@/lib/timezones";
import { Button, cn } from "@/components/ui";
import { useClock } from "@/lib/market/live-clock";
import { useMarketSettings } from "@/lib/market/settings-store";
import { Countdown, ProgressRing } from "./LiveTimer";
import { DayTimeline } from "./DayTimeline";
import { DisplayZonePicker } from "./DisplayZonePicker";
import { InfoPopover } from "./InfoPopover";
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
  seasonNote,
  sessionDefs,
  statusFromList,
  upcomingEvents,
  type MainSessionId,
  type Occurrence,
  type SessionGroup,
  type SessionId,
  type StatusId,
  type SubSessionId,
  type WindowDef,
} from "@/lib/market/sessions";

type State = "open" | "closed" | "weekend";

/** One status style everywhere: a dot and a word (the colour is never the only sign). */
function Status({ state, testId }: { state: State; testId: string }) {
  const { dict } = useApp();
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold", state === "open" ? "text-tx" : "text-mu")} data-testid={testId}>
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", state === "open" ? "bg-vi" : "border border-mu/70")} />
      {dict.market.sessions.status[state]}
    </span>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Market → Overview, compact view (PR 1.1c): three main sessions with live countdowns and their killzones, «What is
 * next» (3 events, beside the cards on wide screens), one table for the overlap and the sub-sessions, hints in
 * floating «?» panels. Everything in the display time. The page follows the minute clock; only the main cards'
 * countdowns and rings tick every second.
 */
export function SessionsClock() {
  const { dict, lang } = useApp();
  const game = useOptionalGame();
  const t = dict.market.sessions;
  const profileZone = game?.gameState.profile.timezone || browserTimeZone();
  const [settings, setSettings, settingsLoaded] = useMarketSettings();
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
    return { lists, events: upcomingEvents([...ALL_SESSIONS.map((id) => defs[id]), ...kzDefs], now, 3) };
  }, [now, defs, kzDefs]);

  if (!now || !data || !settingsLoaded) {
    return <section className="card min-h-[320px]" data-testid="market-sessions" aria-busy="true" />;
  }

  const weekend = !isForexOpen(now);
  const listOf = (id: StatusId) => data.lists.get(id) ?? [];
  const stateOf = (id: StatusId): State => (statusFromList(id, listOf(id), now).state === "open" ? "open" : weekend ? "weekend" : "closed");
  const nameOf = (id: StatusId) => t.names[id];
  const targetOf = (id: StatusId) => {
    const s = statusFromList(id, listOf(id), now);
    return s.state === "open" ? s.end : s.next?.start;
  };

  /** A day word only when it is not today. */
  const dayPrefix = (ms: number) => {
    const off = dayOffset(ms, now, zone);
    if (off === 0) return "";
    if (off < 0) return `${t.yesterday} · `;
    if (off === 1) return `${t.tomorrow} · `;
    return `${formatDate(lang, ms, { timeZone: zone, weekday: "short" })} · `;
  };
  const hoursLine = (id: StatusId) => {
    const occ = currentOrNext(listOf(id), now);
    return occ ? `${dayPrefix(occ.start)}${hoursOf(occ, zone)}` : "";
  };
  const mineLine = (id: StatusId) => {
    const occ = currentOrNext(listOf(id), now);
    return showMine && occ ? formatString(t.myTime, { hours: hoursOf(occ, profileZone) }) : "";
  };

  /** The hint of a session: what it is like, its local hours, and why its hours move during the year. */
  const sessionHint = (id: SessionId) => {
    const def = defs[id];
    const note = seasonNote(def, zone, now);
    const s = t.season;
    const cityIn = t.cityIn[id];
    const where = zone === profileZone ? s.whereMine : s.whereShown;
    const n = Math.abs(note.shiftMinutes) / 60;
    const dir = note.shiftMinutes > 0 ? s.later : s.earlier;
    let why: string;
    if (note.hasDst) {
      const head = formatString(note.season === "summer" ? s.summer : s.winter, { cityIn });
      const other = note.season === "summer" ? s.inWinter : s.inSummer;
      why = head + (note.shiftMinutes ? formatString(s.shift, { where, n, dir, other }) : formatString(s.sameDst, { where }));
    } else {
      const head = capitalize(formatString(s.noDst, { cityIn }));
      why = head + (note.shiftMinutes ? formatString(s.shiftNoDst, { where, n, dir }) : formatString(s.sameNoDst, { where }));
    }
    return (
      <>
        <p className="text-tx">{t.about[def.group as SessionGroup]}</p>
        <p data-testid={`market-${id}-season`}>
          {formatString(s.localHours, { hours: `${def.start}–${def.end}`, offset: timeZoneOffsetLabel(def.zone, new Date(now)) })} {why}
        </p>
        <p className="text-[11px]">{t.aboutNote}</p>
      </>
    );
  };
  const hint = (id: StatusId, content: React.ReactNode) => (
    <InfoPopover id={`market-hint-${id}`} label={nameOf(id)} closeLabel={t.close} testId={`market-${id}`}>
      {content}
    </InfoPopover>
  );

  const killzoneOf: Partial<Record<StatusId, WindowDef>> = { london: kzDefs[0], newyork: kzDefs[1] };

  const card = (id: MainSessionId) => {
    const state = stateOf(id);
    const occ = currentOrNext(listOf(id), now);
    const target = targetOf(id);
    const kz = killzoneOf[id];
    const kzTarget = kz ? targetOf(kz.id) : undefined;
    return (
      <li key={id} className={cn("rounded-lg p-3", state === "open" ? "bg-pri/15 ring-1 ring-vi/40" : "bg-s2/50")} data-testid={`market-card-${id}`} data-state={state}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-serif text-base font-bold text-tx">{nameOf(id)}</h3>
          {hint(id, sessionHint(id))}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <ProgressRing start={occ?.start ?? 0} end={occ?.end ?? 1} open={state === "open"} size={44} data-testid={`market-${id}-ring`} />
          <div className="min-w-0 space-y-0.5">
            <Status state={state} testId={`market-${id}-status`} />
            {target !== undefined && (
              <p className="leading-tight">
                <span className="block text-[11px] text-mu">{state === "open" ? t.status.closesIn : t.status.opensIn}</span>
                <Countdown to={target} className="font-mono text-lg font-semibold tabular-nums text-tx" data-testid={`market-${id}-timer`} />
              </p>
            )}
          </div>
        </div>
        <p className="text-xs tabular-nums text-mu" data-testid={`market-${id}-hours`}>
          {hoursLine(id)}
        </p>
        {showMine && (
          <p className="text-[11px] tabular-nums text-mu" data-testid={`market-${id}-mine`}>
            {mineLine(id)}
          </p>
        )}
        {kz && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line/60 pt-2 text-xs" data-testid={`market-card-${kz.id}`} data-state={stateOf(kz.id)}>
            <span className="font-semibold text-tx">{t.killzone}</span>
            <span className="tabular-nums text-mu" data-testid={`market-${kz.id}-hours`}>
              {hoursLine(kz.id)}
            </span>
            <Status state={stateOf(kz.id)} testId={`market-${kz.id}-status`} />
            {kzTarget !== undefined && <Countdown to={kzTarget} format="human" className="ml-auto tabular-nums text-tx" data-testid={`market-${kz.id}-timer`} />}
          </div>
        )}
      </li>
    );
  };

  /** One row of the table: name and group, hours, status, countdown without seconds, «?». */
  const tableRow = (id: SubSessionId | "overlap") => {
    const target = targetOf(id);
    const group = id === "overlap" ? null : (defs[id].group as SessionGroup);
    return (
      <li
        key={id}
        className="grid grid-cols-[minmax(0,1fr)_auto_auto_2rem] items-center gap-x-3 px-3 py-2 md:grid-cols-[11rem_12rem_7rem_7rem_2rem] md:justify-start"
        data-testid={id === "overlap" ? "market-card-overlap" : `market-sub-${id}`}
        data-state={stateOf(id)}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-tx">{id === "overlap" ? t.day.overlapName : nameOf(id)}</span>
          <span className="block truncate text-[11px] text-mu md:hidden" data-testid={`market-${id}-hours-narrow`}>
            {hoursLine(id)}
          </span>
          {group && <span className="hidden text-[11px] text-mu md:block">{t.groups[group]}</span>}
        </span>
        <span className="hidden text-xs tabular-nums text-mu md:block">
          <span data-testid={`market-${id}-hours`}>{hoursLine(id)}</span>
          {showMine && (
            <span className="block text-[11px]" data-testid={`market-${id}-mine`}>
              {mineLine(id)}
            </span>
          )}
        </span>
        <Status state={stateOf(id)} testId={`market-${id}-status`} />
        <span className="text-right text-xs tabular-nums text-tx">{target !== undefined && <Countdown to={target} format="human" data-testid={`market-${id}-timer`} />}</span>
        {hint(id, id === "overlap" ? <><p className="text-tx">{t.about.overlap}</p><p className="text-[11px]">{t.aboutNote}</p></> : sessionHint(id))}
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
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h2 id="market-sessions-title" className="h4 flex items-center gap-2">
              <Clock size={18} className="text-vi" aria-hidden="true" />
              <span>{t.title}</span>
            </h2>
            <InfoPopover id="market-hint-block" label={t.blockHint} closeLabel={t.close} testId="market-block">
              {gapHours !== 5 && (
                <p className="text-tx" data-testid="market-gap">
                  {formatString(t.gap.title, { h: gapHours })}.{" "}
                  {gapUntil
                    ? formatString(t.gap.hint, { h: gapHours, date: formatDate(lang, gapUntil, { timeZone: zone, day: "numeric", month: "long" }) })
                    : formatString(t.gap.hintNoDate, { h: gapHours })}
                </p>
              )}
              <p>{t.conventions}</p>
              <p className="text-[11px]">{t.aboutNote}</p>
            </InfoPopover>
          </div>
          <p className="text-xs text-mu" data-testid="market-sessions-now">
            {formatString(t.yourTime, { time: clockOf(now, zone), zone: timeZoneLabel(zone, lang, new Date(now)) })}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)} aria-haspopup="dialog" data-testid="market-settings-open">
          <Settings2 size={14} aria-hidden="true" />
          <span>{t.settings.open}</span>
        </Button>
      </div>

      <DisplayZonePicker idPrefix="market" value={settings.display} profileZone={profileZone} onChange={(display) => setSettings({ ...settings, display })} />

      <p className="text-sm text-tx" data-testid="market-active-now">
        {active.length ? formatString(t.activeNow, { list: active.join(", ") }) : weekend ? t.activeWeekend : t.activeNone}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <ul className="grid gap-2 sm:grid-cols-3">{MAIN_SESSIONS.map(card)}</ul>

        <div className="space-y-2 lg:order-none" data-testid="market-next">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.next.title}</h3>
          {weekend && (
            <p className="text-xs text-tx" role="status" data-testid="market-weekend">
              {formatString(t.next.weekend, {
                local: formatDate(lang, nextForexOpen(now), { timeZone: zone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
              })}
            </p>
          )}
          <ol className="space-y-1.5">
            {data.events.map((e) => (
              <li key={`${e.id}-${e.edge}-${e.at}`} className="rounded-md bg-s2/50 px-3 py-2" data-testid="market-next-item">
                <span className="block text-sm text-tx">{eventText(e)}</span>
                <span className="text-xs tabular-nums text-mu">
                  {dayPrefix(e.at)}
                  {clockOf(e.at, zone)} · {formatString(t.next.in, { left: "" }).trim()} <Countdown to={e.at} format="human" className="font-semibold text-tx" />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.subTitle}</h3>
        <ul className="divide-y divide-line/60 rounded-lg bg-s2/30" data-testid="market-subsessions">
          {tableRow("overlap")}
          {SUB_SESSIONS.map(tableRow)}
        </ul>
      </div>

      <div>
        <Button variant="ghost" onClick={() => setShowDay((v) => !v)} aria-expanded={showDay} aria-controls="market-day" data-testid="market-day-toggle">
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", showDay && "rotate-180")} />
          <span>{showDay ? t.day.hide : t.day.show}</span>
        </Button>
        {showDay && (
          <div id="market-day" className="mt-3">
            <DayTimeline now={now} zone={zone} sessions={MAIN_SESSIONS.map((id) => defs[id])} killzones={kzDefs} />
          </div>
        )}
      </div>

      <SessionsSettings open={editing} onClose={() => setEditing(false)} value={settings} onChange={setSettings} displayZone={zone} profileZone={profileZone} now={now} />
    </section>
  );
}
