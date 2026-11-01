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
  wallAt,
  type MainSessionId,
  type Occurrence,
  type SessionGroup,
  type SessionId,
  type StatusId,
  type SubSessionId,
  type WindowDef,
} from "@/lib/market/sessions";

type State = "open" | "closed" | "weekend";

/**
 * One status style everywhere: a dot and a word (the colour is never the only sign). The word is only for screen
 * readers in compact rows and at the weekend: the block says «Weekend» once at the top (PR 1.1d), the dot turns grey.
 */
function Status({ state, testId, compact = false }: { state: State; testId: string; compact?: boolean }) {
  const { dict } = useApp();
  const wordHidden = compact || state === "weekend";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold", state === "open" ? "text-tx" : "text-mu")} data-testid={testId}>
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", state === "open" ? "bg-vi" : state === "weekend" ? "bg-mu/50" : "border border-mu/70")} />
      <span className={wordHidden ? "sr-only" : undefined}>{dict.market.sessions.status[state]}</span>
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
  const dayWord = (ms: number) => {
    const off = dayOffset(ms, now, zone);
    if (off === 0) return "";
    if (off < 0) return t.yesterday;
    if (off === 1) return t.tomorrow;
    return formatDate(lang, ms, { timeZone: zone, weekday: "short" });
  };
  const dayPrefix = (ms: number) => {
    const word = dayWord(ms);
    return word ? `${word} · ` : "";
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

  /**
   * A main session card (PR 1.1c, owner's correction): noticeable — a soft gradient and a border / glow by status —
   * a large filling ring in the middle with the HH:MM:SS countdown inside, the name and status on top, the hours and
   * the group under the ring, its killzone as a compact block. Only these countdowns tick every second.
   */
  const card = (id: MainSessionId) => {
    const state = stateOf(id);
    const occ = currentOrNext(listOf(id), now);
    const target = targetOf(id);
    const kz = killzoneOf[id];
    const kzTarget = kz ? targetOf(kz.id) : undefined;
    const kzOcc = kz ? currentOrNext(listOf(kz.id), now) : undefined;
    const group = defs[id].group as SessionGroup;
    const open = state === "open";
    return (
      <li
        key={id}
        className={cn(
          "flex flex-col rounded-xl border p-4 transition-shadow motion-reduce:transition-none",
          open
            ? "border-vi/60 bg-gradient-to-b from-pri/35 via-pri/10 to-s1 shadow-[0_0_28px_-6px_rgba(163,138,209,0.45)]"
            : "border-line bg-gradient-to-b from-s2/80 to-s1"
        )}
        data-testid={`market-card-${id}`}
        data-state={state}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-bold text-tx">{nameOf(id)}</h3>
            <Status state={state} testId={`market-${id}-status`} />
          </div>
          {hint(id, sessionHint(id))}
        </div>

        <div className="my-3 flex justify-center">
          <ProgressRing start={occ?.start ?? 0} end={occ?.end ?? 1} open={open} size={148} stroke={3.5} data-testid={`market-${id}-ring`}>
            {target !== undefined && (
              <span className="flex max-w-[124px] flex-col items-center leading-tight">
                <span className="whitespace-nowrap text-[11px] text-mu">{open ? t.status.closesIn : t.status.opensIn}</span>
                <Countdown
                  to={target}
                  className="font-mono text-xl font-semibold text-tx"
                  longClassName="text-[15px] font-semibold text-tx"
                  data-testid={`market-${id}-timer`}
                />
              </span>
            )}
          </ProgressRing>
        </div>

        <div className="text-center">
          <p className="text-sm tabular-nums text-tx" data-testid={`market-${id}-hours`}>
            {hoursLine(id)}
          </p>
          {showMine && (
            <p className="text-[11px] tabular-nums text-mu" data-testid={`market-${id}-mine`}>
              {mineLine(id)}
            </p>
          )}
          <p className="text-[11px] text-mu" data-testid={`market-${id}-group`}>
            {t.groups[group]}
          </p>
        </div>

        {kz && (
          <div
            className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md bg-s1/60 px-3 py-2 text-xs"
            data-testid={`market-card-${kz.id}`}
            data-state={stateOf(kz.id)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Status state={stateOf(kz.id)} testId={`market-${kz.id}-status`} compact />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="whitespace-nowrap">
                  <span className="font-semibold text-tx">{t.killzone}</span>
                  <span className="text-mu"> · </span>
                  <span className="tabular-nums text-mu" data-testid={`market-${kz.id}-hours`}>
                    {kzOcc ? hoursOf(kzOcc, zone) : ""}
                  </span>
                </span>
                {/* the day under the hours, small, as in «What is next» — the row never wraps in the middle */}
                {kzOcc && dayWord(kzOcc.start) && (
                  <span className="text-[10px] text-mu" data-testid={`market-${kz.id}-day`}>
                    {dayWord(kzOcc.start)}
                  </span>
                )}
              </span>
            </span>
            <span className="text-right">{kzTarget !== undefined && <Countdown to={kzTarget} format="human" className="font-semibold text-tx" data-testid={`market-${kz.id}-timer`} />}</span>
          </div>
        )}
      </li>
    );
  };

  /**
   * One row of the table (PR 1.1d): the same columns in every row — the status dot, the name and the hours (two lines)
   * on the left, the countdown on the right (one line, one format in all rows), then «?».
   */
  const tableRow = (id: SubSessionId | "overlap") => {
    const target = targetOf(id);
    const group = id === "overlap" ? null : (defs[id].group as SessionGroup);
    return (
      <li
        key={id}
        className="grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-3 px-3 py-2"
        data-testid={id === "overlap" ? "market-card-overlap" : `market-sub-${id}`}
        data-state={stateOf(id)}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="pt-1.5">
            <Status state={stateOf(id)} testId={`market-${id}-status`} compact />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-snug text-tx">
              {id === "overlap" ? t.day.overlapName : nameOf(id)}
              {group && <span className="hidden font-normal text-mu md:inline"> · {t.groups[group]}</span>}
            </span>
            <span className="block text-[11px] tabular-nums text-mu">
              <span className="whitespace-nowrap" data-testid={`market-${id}-hours`}>
                {hoursLine(id)}
              </span>
              {/* «For you: …» gets its own line on phones instead of being cut */}
              {showMine && (
                <span className="block whitespace-nowrap md:inline" data-testid={`market-${id}-mine`}>
                  <span className="hidden md:inline"> · </span>
                  {mineLine(id)}
                </span>
              )}
            </span>
          </span>
        </span>
        <span className="text-right text-xs text-tx">{target !== undefined && <Countdown to={target} format="human" className="font-semibold" data-testid={`market-${id}-timer`} />}</span>
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

      <DisplayZonePicker
        idPrefix="market"
        quick
        zoneName={zone === "UTC" ? "UTC" : timeZoneLabel(zone, lang, new Date(now))}
        value={settings.display}
        profileZone={profileZone}
        onChange={(display) => setSettings({ ...settings, display })}
      />

      {weekend ? (
        <p className="rounded-md bg-s2/50 px-3 py-2 text-sm text-tx" role="status" data-testid="market-weekend">
          {formatString(t.weekendLine, { day: t.weekdayAt[wallAt(nextForexOpen(now), zone).wd], time: clockOf(nextForexOpen(now), zone) })}
        </p>
      ) : (
        <p className="text-sm text-tx" data-testid="market-active-now">
          {active.length ? formatString(t.activeNow, { list: active.join(", ") }) : t.activeNone}
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-3">{MAIN_SESSIONS.map(card)}</ul>

      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.subTitle}</h3>
        <ul className="divide-y divide-line/60 rounded-lg bg-s2/30" data-testid="market-subsessions">
          {tableRow("overlap")}
          {SUB_SESSIONS.map(tableRow)}
        </ul>
      </div>

      <div className="space-y-2" data-testid="market-next">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.next.title}</h3>
        {/* A list with thin dividers (PR 1.1d): the time on the left with the day under it, the event, «in …» */}
        <ol className="divide-y divide-line/60">
          {data.events.map((e) => {
            const word = dayWord(e.at);
            return (
              <li key={`${e.id}-${e.edge}-${e.at}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5" data-testid="market-next-item">
                <span className="flex flex-col leading-tight">
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-tx" data-testid="market-next-time">
                    {clockOf(e.at, zone)}
                  </span>
                  {word && <span className="whitespace-nowrap text-[10px] text-mu">{word}</span>}
                </span>
                <span className="min-w-0 text-sm text-tx">{eventText(e)}</span>
                <span className="whitespace-nowrap text-right text-xs font-semibold text-vi" data-testid="market-next-left">
                  {formatString(t.next.in, { left: "" }).trim()} <Countdown to={e.at} format="human" />
                </span>
              </li>
            );
          })}
        </ol>
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
