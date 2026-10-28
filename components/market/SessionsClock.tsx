"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleDot, Clock, Moon, Settings2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatDate, formatString } from "@/lib/i18n";
import { browserTimeZone, timeZoneLabel } from "@/lib/timezones";
import { AppStorage } from "@/lib/storage";
import { Button, Input, cn } from "@/components/ui";
import { SettingRow } from "@/components/ui/SettingRow";
import { useClock } from "@/lib/market/live-clock";
import { Countdown, ProgressRing } from "./LiveTimer";
import { DayTimeline } from "./DayTimeline";
import {
  DEFAULT_KILLZONES,
  NEW_YORK,
  SESSIONS,
  clockOf,
  currentOrNext,
  dayOffset,
  gapBackToUsual,
  hoursOf,
  instantOf,
  isForexOpen,
  isValidWindow,
  killzoneDefs,
  londonNewYorkGapHours,
  londonNewYorkOverlap,
  normalizeKillzones,
  occurrences,
  statusFromList,
  upcomingEvents,
  wallAt,
  type KillzoneId,
  type KillzoneSettings,
  type Occurrence,
  type StatusId,
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
 * Market → Overview: Tokyo, London and New York with their live countdowns, the London and New York killzones inside
 * their cards, the London + New York overlap, «What is next», and the 24-hour bar under «Show 24 h».
 *
 * The page follows the minute clock (windows open and close on whole minutes); only the countdowns and the rings
 * tick every second (`LiveTimer`), so the seconds never re-render the page.
 */
export function SessionsClock() {
  const { dict, lang } = useApp();
  const game = useOptionalGame();
  const t = dict.market.sessions;
  const zone = game?.gameState.profile.timezone || browserTimeZone();
  const now = useClock("minute");

  const [killzones, setKillzones] = useState<KillzoneSettings>(DEFAULT_KILLZONES);
  useEffect(() => setKillzones(readKillzones()), []);
  const [editing, setEditing] = useState(false);
  const [showDay, setShowDay] = useState(false);
  const kzDefs = useMemo(() => killzoneDefs(killzones), [killzones]);

  const data = useMemo(() => {
    if (!now) return null;
    const lists = new Map<StatusId, Occurrence[]>();
    for (const d of [...SESSIONS, ...kzDefs]) lists.set(d.id, occurrences(d, now));
    lists.set("overlap", londonNewYorkOverlap(now));
    return { lists, events: upcomingEvents([...SESSIONS, ...kzDefs], now, 5) };
  }, [now, kzDefs]);

  if (!now || !data) {
    return <section className="card min-h-[320px]" data-testid="market-sessions" aria-busy="true" />;
  }

  const weekend = !isForexOpen(now);
  const listOf = (id: StatusId) => data.lists.get(id) ?? [];
  const stateOf = (id: StatusId): State => (statusFromList(id, listOf(id), now).state === "open" ? "open" : weekend ? "weekend" : "closed");
  const nameOf = (id: StatusId) => t.names[id];
  const nowClock = clockOf(now, zone);

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
        <Countdown
          to={target}
          className={cn("font-mono tabular-nums text-tx", big ? "text-2xl font-semibold" : "text-sm font-semibold")}
          data-testid={`market-${id}-timer`}
        />
      </span>
    );
  };

  const hoursLine = (id: StatusId) => {
    const occ = currentOrNext(listOf(id), now);
    return occ ? `${dayWord(occ.start)} · ${hoursOf(occ, zone)}` : "";
  };

  const killzoneOf: Partial<Record<StatusId, WindowDef>> = { london: kzDefs[0], newyork: kzDefs[1] };

  const card = (def: WindowDef) => {
    const state = stateOf(def.id);
    const occ = currentOrNext(listOf(def.id), now);
    const kz = killzoneOf[def.id];
    return (
      <li
        key={def.id}
        className={cn("flex flex-col gap-3 rounded-lg border p-4", state === "open" ? "border-vi/60 bg-pri/10" : "border-line bg-s2/30")}
        data-testid={`market-card-${def.id}`}
        data-state={state}
      >
        <div className="flex items-start gap-3">
          <ProgressRing start={occ?.start ?? 0} end={occ?.end ?? 1} open={state === "open"} data-testid={`market-${def.id}-ring`}>
            {state === "open" ? <CircleDot size={18} aria-hidden="true" /> : state === "weekend" ? <Moon size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
          </ProgressRing>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-serif text-lg font-bold text-tx">{nameOf(def.id)}</h3>
              <StatusBadge state={state} testId={`market-${def.id}-status`} />
            </div>
            {countdownOf(def.id, true)}
            <p className="text-xs tabular-nums text-mu" data-testid={`market-${def.id}-hours`}>
              {hoursLine(def.id)}
            </p>
          </div>
        </div>
        {kz && (
          <div className="space-y-1 border-t border-line pt-3" data-testid={`market-card-${kz.id}`} data-state={stateOf(kz.id)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-tx">
                {t.killzone} <span className="text-xs font-normal tabular-nums text-mu" data-testid={`market-${kz.id}-hours`}>{hoursLine(kz.id)}</span>
              </span>
              <StatusBadge state={stateOf(kz.id)} testId={`market-${kz.id}-status`} />
            </div>
            {countdownOf(kz.id, false)}
          </div>
        )}
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
  const active = [...SESSIONS, ...kzDefs].map((d) => d.id as StatusId).concat("overlap").filter((id) => stateOf(id) === "open").map(nameOf);

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

      {editing && <KillzoneSettingsForm id="market-killzones-settings" value={killzones} zone={zone} now={now} onChange={(v) => { setKillzones(v); writeKillzones(v); }} />}

      <p className="text-sm font-semibold text-tx" data-testid="market-active-now">
        {active.length ? formatString(t.activeNow, { list: active.join(", ") }) : weekend ? t.activeWeekend : t.activeNone}
      </p>

      <ul className="grid gap-3 lg:grid-cols-3">{SESSIONS.map(card)}</ul>

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
            <DayTimeline now={now} zone={zone} killzones={kzDefs} />
          </div>
        )}
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
