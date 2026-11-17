"use client";

import React, { useId, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, CircleDashed, Hourglass } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { addDaysToKey } from "@/lib/day-key";
import { PQ_CHAPTERS, PQ_NOTE_FIELDS, PQ_NOTE_MAX, PQ_PERIOD_DAYS, categoryOf, chapterOf, dayNumber, phaseOf, type PQNoteField, type PQRun } from "@/lib/personal-quests";
import type { PQDayState, PQDayView, PQJourney } from "@/lib/personal-quest-days";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { historyTitle } from "./quest-text";
import { formatDayKey } from "./WeekTab";
import { errorText } from "./PersonalQuestParts";

// QH-8.3: the daily journey of a personal quest — completion (separate from the calendar), the 30 days, the chapters,
// today's action, the diary and the mark history. Marks and notes give nothing; data-confirmed days come from the Journal.

/** Completion: confirmed days of 30 — not the calendar day. */
export function ProgressRing({ done, size = 64 }: { done: number; size?: number }) {
  const { dict } = useApp();
  const j = dict.personalQuests.path.journey;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={formatString(j.progressAria, { n: done })} data-testid="pq-ring" data-done={done}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-s2" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - done / PQ_PERIOD_DAYS)}
          className="stroke-vi motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-serif text-sm font-bold text-tx" aria-hidden="true">
        {done}
      </span>
    </div>
  );
}

const DAY_TONE: Record<PQDayState, string> = {
  confirmed: "border-vi/60 bg-vi/25 text-tx",
  missed: "border-line bg-s2/60 text-mu",
  today: "border-vi bg-transparent text-tx",
  future: "border-dashed border-line bg-transparent text-mu/70",
  pending: "border-[#e5b98a]/40 bg-[#e5b98a]/[0.06] text-[#e5b98a]",
  closed: "border-transparent bg-transparent text-mu/40",
};

/** The 30 days: done, missed, today, ahead (or waiting for the Journal check). Each cell says its state to a screen reader. */
export function DayGrid({ journey, today }: { journey: PQJourney; today: string }) {
  const { dict, lang } = useApp();
  const j = dict.personalQuests.path.journey;
  return (
    <div>
      <ol className="grid grid-cols-6 gap-1.5 sm:grid-cols-10" data-testid="pq-days" aria-label={j.calendarTitle}>
        {journey.days.map((d) => (
          <li
            key={d.day}
            data-testid="pq-day"
            data-day={d.day}
            data-n={d.n}
            data-state={d.state}
            aria-current={d.day === today ? "date" : undefined}
            className={cn("relative grid h-10 place-items-center rounded-lg border text-xs font-semibold", DAY_TONE[d.state], d.day === today && "ring-2 ring-vi ring-offset-1 ring-offset-s1")}
          >
            <span aria-hidden="true">{d.state === "confirmed" ? <Check size={14} /> : d.state === "pending" ? <Hourglass size={12} /> : d.n}</span>
            {d.note && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-go/80" />}
            <span className="sr-only">{formatString(j.dayAria, { date: formatDayKey(d.day, lang, { day: "numeric", month: "long" }), n: d.n, state: j.states[d.state] })}</span>
          </li>
        ))}
      </ol>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mu" aria-hidden="true">
        {(["confirmed", "missed", "today", "future", ...(journey.pending ? ["pending"] : [])] as Array<keyof typeof j.legend>).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-3 rounded border", DAY_TONE[k as PQDayState], k === "today" && "ring-1 ring-vi")} />
            {j.legend[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The four chapters by the calendar: passed, now, ahead — with the current one's text and the next one. */
export function ChapterBlock({ run, today, compact }: { run: PQRun; today: string; compact?: boolean }) {
  const { dict } = useApp();
  const c = dict.personalQuests.path.journey.chapters;
  const n = dayNumber(run, today);
  const cur = chapterOf(n);
  const idx = PQ_CHAPTERS.indexOf(cur);
  const next = PQ_CHAPTERS[idx + 1];
  if (compact) {
    return (
      <p className="text-xs text-mu" data-testid="pq-chapter-line" data-chapter={cur.id}>
        <span className="font-semibold text-tx">{formatString(c.current, { n: idx + 1 })}</span> · {c[cur.id].name}
      </p>
    );
  }
  return (
    <section className="rounded-xl border border-line bg-s2/40 p-3" data-testid="pq-chapter" data-chapter={cur.id} aria-labelledby={`pq-chapter-${run.id}`}>
      <h3 id={`pq-chapter-${run.id}`} className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{c.title}</h3>
      <ol className="mt-2 grid grid-cols-4 gap-1.5">
        {PQ_CHAPTERS.map((ch, i) => {
          const state = i < idx ? "passed" : i === idx ? "now" : "ahead";
          return (
            <li key={ch.id} className="min-w-0" data-testid={`pq-chapter-${ch.id}`} data-state={state} aria-current={state === "now" ? "step" : undefined}>
              <div className={cn("h-1.5 rounded-full", state === "passed" ? "bg-vi" : state === "now" ? "bg-vi/60" : "bg-s2")} aria-hidden="true" />
              <div className={cn("mt-1 truncate text-[11px]", state === "now" ? "font-semibold text-tx" : "text-mu")}>{c[ch.id].name}</div>
              <span className="sr-only">{`${formatString(c.days, { from: ch.from, to: ch.to })}, ${c[state]}`}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-serif text-base font-bold text-tx">{c[cur.id].name}</span>
          <span className="text-xs text-mu">
            {formatString(c.current, { n: idx + 1 })} · {formatString(c.days, { from: cur.from, to: cur.to })}
          </span>
        </div>
        <p className="mt-1 text-sm text-mu">{c[cur.id].text}</p>
        <p className="mt-1.5 text-xs text-tx" data-testid="pq-chapter-next">
          {next ? formatString(c.next, { name: c[next.id].name, day: next.from }) : c.last}
        </p>
      </div>
    </section>
  );
}

/** Today's action: «Mark as done» for a self-report; the Journal's confirmation (or what it waits for) for AYRA data. */
export function TodayAction({ run, journey, today, onMarked }: { run: PQRun; journey: PQJourney; today: string; onMarked?: () => void }) {
  const { dict, showToast } = useApp();
  const { gameState, markPersonalQuestDay } = useGame();
  const j = dict.personalQuests.path.journey.today;
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const day = journey.days.find((d) => d.day === today);
  const phase = phaseOf(run, today);
  const mark = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const res = await markPersonalQuestDay(run.id);
      if (res.ok) {
        showToast(j.marked);
        onMarked?.();
      } else showToast(errorText(dict, res.reason));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const checks = (categoryOf(run.category)?.appChecks ?? []).map((id) => historyTitle(dict, id, "")).filter(Boolean).join(", ");
  let body: React.ReactNode;
  if (run.status === "abandoned") body = <p className="text-sm text-mu">{j.closed}</p>;
  else if (phase === "awaitingReport") body = <p className="text-sm text-mu">{j.periodOver}</p>;
  else if (run.verification === "self") {
    body =
      day?.state === "confirmed" ? (
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-tx" data-testid="pq-today-done">
          <Check size={16} aria-hidden="true" className="text-vi" />
          {j.selfDone}
        </p>
      ) : (
        <button type="button" className={buttonClasses("primary")} onClick={mark} disabled={saving} data-testid="pq-mark">
          <Check size={16} aria-hidden="true" />
          {saving ? j.marking : j.mark}
        </button>
      );
  } else if (journey.pending) {
    body = (
      <p className="inline-flex items-center gap-2 text-sm text-[#e5b98a]" data-testid="pq-today-pending">
        <Hourglass size={15} aria-hidden="true" />
        {j.pending}
      </p>
    );
  } else if (day?.state === "confirmed") {
    body = (
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-tx" data-testid="pq-today-done">
        <Check size={16} aria-hidden="true" className="text-vi" />
        {formatString(j.appDone, { check: historyTitle(dict, day.mark?.check ?? "", "") })}
      </p>
    );
  } else {
    // a fitting record of today already counts for another personal quest (В-24): say so, and which one
    const holder = journey.takenBy.get(today);
    const holderTitle = holder ? (gameState.personalRuns ?? []).find((r) => r.id === holder)?.title ?? "" : "";
    body = (
      <div className="space-y-2" data-testid="pq-today-waiting" data-taken-by={holder ?? ""}>
        <p className="inline-flex items-center gap-2 text-sm text-tx">
          <CircleDashed size={15} aria-hidden="true" className="shrink-0 text-mu" />
          {holder ? formatString(j.appTaken, { title: holderTitle }) : formatString(j.appWaiting, { checks })}
        </p>
        <Link href="/journal" className={buttonClasses("secondary", "md", "w-fit")} data-testid="pq-open-journal">
          <BookOpen size={15} aria-hidden="true" />
          {j.openJournal}
        </Link>
      </div>
    );
  }
  return (
    <div data-testid="pq-today" data-state={day?.state ?? "none"}>
      {body}
      {run.status !== "abandoned" && phase === "active" && (
        <p className="mt-1.5 text-[11px] text-mu">{run.verification === "self" ? j.selfHint : formatString(j.appHint, { checks })}</p>
      )}
    </div>
  );
}

/** The quest diary: a short note on today or yesterday (yesterday never confirms the action), and the earlier notes. */
export function Diary({ run, journey, today }: { run: PQRun; journey: PQJourney; today: string }) {
  const { dict, lang, showToast } = useApp();
  const { savePersonalQuestNote } = useGame();
  const d = dict.personalQuests.path.journey.diary;
  const formId = useId();
  const yesterday = addDaysToKey(today, -1);
  const open = run.status !== "abandoned" && run.status !== "completed";
  const days = [today, yesterday].filter((k) => k >= run.startDay && journey.days.some((x) => x.day === k));
  const [day, setDay] = useState(days[0] ?? today);
  const existing = (run.notes ?? []).find((n) => n.day === day);
  const blank = { done: "", worked: "", hard: "", learned: "" };
  const [fields, setFields] = useState<Record<PQNoteField, string>>(existing ? { done: existing.done, worked: existing.worked, hard: existing.hard, learned: existing.learned } : blank);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const pick = (k: string) => {
    setDay(k);
    const n = (run.notes ?? []).find((x) => x.day === k);
    setFields(n ? { done: n.done, worked: n.worked, hard: n.hard, learned: n.learned } : blank);
    setError("");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const res = await savePersonalQuestNote(run.id, { day, ...fields });
      if (res.ok) {
        setError("");
        showToast(d.saved);
      } else setError(errorText(dict, res.reason));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const notes = [...(run.notes ?? [])].sort((a, b) => b.day.localeCompare(a.day));
  const nOf = (k: string) => journey.days.find((x) => x.day === k)?.n ?? 0;
  return (
    <section className="rounded-xl border border-line bg-s2/40 p-3" data-testid="pq-diary" aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`} className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{d.title}</h3>
      <p className="mt-1 text-xs text-mu">{d.intro}</p>
      {open && days.length > 0 ? (
        <form className="mt-3 space-y-3" onSubmit={save} data-testid="pq-diary-form">
          {days.length > 1 && (
            <fieldset>
              <legend className="text-xs font-semibold text-tx">{d.day}</legend>
              <div className="mt-1 inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label={d.day}>
                {days.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={day === k}
                    onClick={() => pick(k)}
                    data-testid={`pq-diary-day-${k === today ? "today" : "yesterday"}`}
                    className={cn("min-h-[40px] rounded-md px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", day === k ? "bg-vi/20 text-tx" : "text-mu hover:text-tx")}
                  >
                    {k === today ? d.today : d.yesterday}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {day !== today && (
            <p className="rounded-lg border border-[#e5b98a]/40 bg-[#e5b98a]/[0.06] px-3 py-2 text-xs text-[#e5b98a]" data-testid="pq-diary-late">
              {d.yesterdayNote}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {PQ_NOTE_FIELDS.map((f) => (
              <div key={f}>
                <label htmlFor={`${formId}-${f}`} className="text-xs font-semibold text-tx">
                  {d.fields[f]}
                </label>
                <textarea
                  id={`${formId}-${f}`}
                  rows={2}
                  maxLength={PQ_NOTE_MAX}
                  value={fields[f]}
                  onChange={(e) => setFields((x) => ({ ...x, [f]: e.target.value }))}
                  data-testid={`pq-diary-${f}`}
                  className="mt-1 w-full resize-y rounded-lg border border-line bg-s2 px-3 py-2 text-sm text-tx focus-visible:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                />
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger" data-testid="pq-diary-error">
              {error}
            </p>
          )}
          <button type="submit" className={buttonClasses("secondary")} disabled={saving} data-testid="pq-diary-save">
            {saving ? d.saving : d.save}
          </button>
        </form>
      ) : (
        !open && <p className="mt-2 text-xs text-mu">{d.closed}</p>
      )}
      <h4 className="mt-4 text-xs font-semibold text-tx">{d.entries}</h4>
      {notes.length === 0 ? (
        <p className="mt-1 text-xs text-mu">{d.empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/60" data-testid="pq-diary-entries">
          {notes.map((n) => (
            <li key={n.day} className="py-2 text-sm" data-testid="pq-diary-entry" data-day={n.day} data-late={n.savedOn > n.day}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-mu">
                <span className="font-semibold text-tx">{formatString(d.dayTitle, { n: nOf(n.day), date: formatDayKey(n.day, lang, { day: "numeric", month: "long" }) })}</span>
                {n.savedOn > n.day && <span className="rounded-full border border-[#e5b98a]/40 px-2 py-0.5 text-[11px] text-[#e5b98a]" data-testid="pq-diary-entry-late">{d.late}</span>}
              </div>
              <dl className="mt-1 space-y-0.5">
                {PQ_NOTE_FIELDS.filter((f) => n[f]).map((f) => (
                  <div key={f} className="break-words">
                    <dt className="inline text-mu">{d.fields[f]}: </dt>
                    <dd className="inline text-tx">{n[f]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every mark that counts, newest first: the day, how it was confirmed, when. */
export function MarkHistory({ journey }: { journey: PQJourney }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const tz = gameState.profile?.timezone || undefined;
  const h = dict.personalQuests.path.journey.history;
  const time = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)) : "");
  const marks = [...journey.marks].sort((a, b) => b.day.localeCompare(a.day));
  const nOf = (k: string) => journey.days.find((x: PQDayView) => x.day === k)?.n ?? 0;
  return (
    <section className="rounded-xl border border-line bg-s2/40 p-3" data-testid="pq-marks">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{h.title}</h3>
      {marks.length === 0 ? (
        <p className="mt-1 text-xs text-mu">{h.empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/60">
          {marks.map((m) => (
            <li key={m.day} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm" data-testid="pq-mark-item" data-day={m.day} data-source={m.source}>
              <span className="text-tx">{formatString(dict.personalQuests.path.journey.diary.dayTitle, { n: nOf(m.day), date: formatDayKey(m.day, lang, { day: "numeric", month: "short" }) })}</span>
              <span className="text-xs text-mu">
                {m.source === "self" ? h.self : formatString(h.app, { check: historyTitle(dict, m.check ?? "", "") })}
                {time(m.at) ? ` · ${formatString(h.at, { time: time(m.at) })}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
