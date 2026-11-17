"use client";

import React, { useMemo, useRef, useState } from "react";
import { Check, Clock, HardDrive, Plus, RotateCcw, Sparkles } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { dayKeyInZone } from "@/lib/day-key";
import type { MissionData } from "@/lib/missions";
import { PQ_MAX_ACTIVE, PQ_PERIOD_DAYS, PQ_RANK_XP, activeRuns, dayNumber, daysLeft, endDayOf, phaseOf, type PQRun } from "@/lib/personal-quests";
import { journeysOf, type PQJourney } from "@/lib/personal-quest-days";
import { Modal } from "@/components/ui/Modal";
import { buttonClasses } from "@/components/ui/Button";
import { formatDayKey } from "./WeekTab";
import { PersonalQuestWizard } from "./PersonalQuestWizard";
import { CATEGORY_ICONS, CategoryIcon, RewardTable, VerificationLabel, errorText, newPqId } from "./PersonalQuestParts";
import { ChapterBlock, DayGrid, Diary, MarkHistory, ProgressRing, TodayAction } from "./PersonalJourney";

// «My path» (QH-8.2, QH-8.3): personal 30-day quests — start, the daily journey (marks, Journal confirmations, chapters,
// diary), abandon, restart. Nothing here gives XP or Coins: rewards are shown as future ones (variant C, QH-8.5).

/* ------------------------------------------------------------------ the main column */

/**
 * `journal`: the saved Journal as the mission checks read it, or null while it is not read or its cloud copy is still
 * loading — then data-confirmed days wait for the check instead of being decided from missing data.
 */
export function PathMain({ journal }: { journal: MissionData | null }) {
  const { dict, showToast } = useApp();
  const { gameState, gameDay } = useGame();
  const p = dict.personalQuests.path;
  const tz = gameState.profile?.timezone;
  const runs = useMemo(() => gameState.personalRuns ?? [], [gameState.personalRuns]);
  const active = activeRuns(runs, gameDay);
  const past = runs.filter((r) => !active.includes(r));
  // the Journal's records are shared out once among all runs (В-24: one record confirms at most one personal quest)
  const journeys = useMemo(() => journeysOf(runs, gameDay, journal, tz), [runs, gameDay, journal, tz]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const openRun = runs.find((r) => r.id === openRunId) ?? null;
  const full = active.length >= PQ_MAX_ACTIVE;

  return (
    <div className="space-y-4" data-testid="pq-main" data-journal={journal ? "ready" : "pending"}>
      <section className="rounded-2xl border border-line bg-s1 bg-[radial-gradient(80%_140%_at_100%_0%,rgb(var(--c-pri)/0.2),transparent_60%)] p-4 sm:p-5" aria-labelledby="pq-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-[620px]">
            <h2 id="pq-title" className="font-serif text-2xl font-bold text-tx">{p.title}</h2>
            <p className="mt-1 text-sm text-mu">{p.intro}</p>
            <p className="mt-2 text-xs font-semibold text-tx" data-testid="pq-slots" data-active={active.length}>
              {formatString(p.slots, { n: active.length })}
            </p>
          </div>
          {active.length > 0 && (
            <button type="button" className={buttonClasses("primary")} onClick={() => setWizardOpen(true)} disabled={full} data-testid="pq-new">
              <Plus size={16} aria-hidden="true" />
              {p.newQuest}
            </button>
          )}
        </div>
        {full && (
          <p className="mt-3 text-xs text-mu" data-testid="pq-full">
            {p.slotsFull}
          </p>
        )}
      </section>

      {active.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-line bg-s1/60 p-6 text-center" data-testid="pq-empty">
          <Sparkles size={22} aria-hidden="true" className="mx-auto text-vi" />
          <h3 className="mt-2 font-serif text-lg font-bold text-tx">{p.emptyTitle}</h3>
          <p className="mx-auto mt-1 max-w-[460px] text-sm text-mu">{p.emptyText}</p>
          <button type="button" className={buttonClasses("primary", "md", "mt-4")} onClick={() => setWizardOpen(true)} data-testid="pq-new">
            <Plus size={16} aria-hidden="true" />
            {p.emptyCta}
          </button>
        </section>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3" data-testid="pq-active">
          {active.map((r) => (
            <li key={r.id} className="min-w-0">
              <RunCard run={r} journey={journeys.get(r.id)!} today={gameDay} onOpen={() => setOpenRunId(r.id)} />
            </li>
          ))}
        </ul>
      )}

      <RunHistory runs={past} allRuns={runs} onOpen={setOpenRunId} />

      {wizardOpen && (
        <PersonalQuestWizard
          runs={runs}
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            showToast(p.created);
          }}
        />
      )}
      {openRun && <RunJourney run={openRun} journey={journeys.get(openRun.id)!} today={gameDay} onClose={() => setOpenRunId(null)} />}
    </div>
  );
}

/** Completion and the calendar side by side — never one for the other. */
function JourneyStats({ run, journey, today }: { run: PQRun; journey: PQJourney; today: string }) {
  const { dict } = useApp();
  const c = dict.personalQuests.path.card;
  const j = dict.personalQuests.path.journey;
  const n = dayNumber(run, today);
  const left = daysLeft(run, today);
  const over = phaseOf(run, today) === "awaitingReport";
  const stopped = run.status === "abandoned";
  return (
    <div className="flex items-center gap-3">
      <ProgressRing done={journey.confirmed} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{j.progressLabel}</span>
          <span className="text-sm font-semibold text-tx" data-testid="pq-card-done" data-done={journey.confirmed}>
            {formatString(j.progressValue, { n: journey.confirmed })}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{j.calendarLabel}</span>
          <span className="font-serif text-sm font-bold text-tx" data-testid="pq-card-day" data-day={n}>
            {formatString(c.day, { n })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-s2" aria-hidden="true">
          <div className="h-full rounded-full bg-mu/50 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${(n / PQ_PERIOD_DAYS) * 100}%` }} />
        </div>
        <div className="flex flex-wrap justify-between gap-x-2 text-[11px] text-mu">
          {!stopped && (
            <span className="inline-flex items-center gap-1" data-testid="pq-card-left" data-left={left}>
              <Clock size={11} aria-hidden="true" />
              {over ? c.periodOver : left === 1 ? c.lastDay : formatString(c.left, { n: left })}
            </span>
          )}
          <span data-testid="pq-card-missed" data-missed={journey.missed}>{formatString(j.missed, { n: journey.missed })}</span>
        </div>
      </div>
    </div>
  );
}

/** One active run: progress, chapter, today's action, how it is confirmed, what it may give at the end. */
function RunCard({ run, journey, today, onOpen }: { run: PQRun; journey: PQJourney; today: string; onOpen: () => void }) {
  const { dict } = useApp();
  const p = dict.personalQuests;
  const c = p.path.card;
  const j = p.path.journey;
  const AchIcon = CATEGORY_ICONS[run.category];
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-s1 p-4 transition-colors hover:border-vi/50" data-testid="pq-card" data-run={run.id} data-category={run.category}>
      <div className="flex items-start gap-3">
        <CategoryIcon category={run.category} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-mu">{p.categories[run.category].name}</div>
          <h3 className="break-words font-serif text-lg font-bold leading-snug text-tx" data-testid="pq-card-title">{run.title}</h3>
          <ChapterBlock run={run} today={today} compact />
        </div>
      </div>

      <div className="mt-3">
        <JourneyStats run={run} journey={journey} today={today} />
      </div>

      <dl className="mt-3 text-sm">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{c.action}</dt>
        <dd className="break-words text-tx" data-testid="pq-card-action">{run.dailyAction}</dd>
      </dl>

      <div className="mt-3 rounded-xl border border-line bg-s2/40 p-3">
        <TodayAction run={run} journey={journey} today={today} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <VerificationLabel verification={run.verification} />
        <span className="inline-flex items-center gap-1 rounded-full border border-go/30 bg-go/[0.06] px-2 py-0.5 text-[11px] font-semibold text-go" data-testid="pq-card-achievement">
          <AchIcon size={11} aria-hidden="true" />
          {formatString(c.achievement, { name: p.achievements[run.category].name })}
        </span>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <span className="text-xs text-mu" data-testid="pq-card-reward">
          {formatString(c.reward, { xp: PQ_RANK_XP[run.verification].gold })}
        </span>
        <button type="button" className={buttonClasses("secondary", "md")} onClick={onOpen} aria-label={formatString(j.openAria, { title: run.title })} data-testid="pq-card-open">
          {j.open}
        </button>
      </div>
    </article>
  );
}

/** The whole path of a run: today, the 30 days, chapters, diary, marks, the quest itself — and abandoning (confirmed). */
function RunJourney({ run, journey, today, onClose }: { run: PQRun; journey: PQJourney; today: string; onClose: () => void }) {
  const { dict, lang, showToast } = useApp();
  const { abandonPersonalQuest } = useGame();
  const p = dict.personalQuests;
  const d = p.path.details;
  const j = p.path.journey;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const phase = phaseOf(run, today);
  const open = phase === "active" || phase === "awaitingReport";
  const fmt = (k: string) => formatDayKey(k, lang, { day: "numeric", month: "long" });
  const abandon = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await abandonPersonalQuest(run.id);
      if (res.ok) {
        setConfirming(false);
        onClose();
        showToast(p.path.abandon.done);
      } else setError(errorText(dict, res.reason));
    } finally {
      busy.current = false;
    }
  };
  const rows: Array<[string, string, string]> = [
    ["goal", d.goal, run.goal],
    ["dailyAction", d.dailyAction, run.dailyAction],
    ["startState", d.startState, run.startState],
    ["expectedResult", d.expectedResult, run.expectedResult],
    ["period", d.period, formatString(d.periodValue, { from: fmt(run.startDay), to: fmt(endDayOf(run)) })],
  ];
  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={run.title}
        subtitle={`${p.categories[run.category].name} · ${run.status === "abandoned" ? p.path.history.abandoned : formatString(p.path.card.day, { n: dayNumber(run, today) })}`}
        closeLabel={d.close}
        size="xl"
        fullOnMobile
        data-testid="pq-details"
        footer={
          <>
            {open && (
              <button type="button" className={buttonClasses("danger")} onClick={() => setConfirming(true)} data-testid="pq-abandon">
                {d.abandon}
              </button>
            )}
            <button type="button" className={buttonClasses("secondary")} onClick={onClose}>
              {d.close}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-xl border border-line bg-s2/40 p-3">
              <JourneyStats run={run} journey={journey} today={today} />
              <div className="mt-2"><VerificationLabel verification={run.verification} /></div>
            </section>
            <section className="rounded-xl border border-line bg-s2/40 p-3" aria-label={j.today.title}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{j.today.title}</h3>
              <p className="mt-1 break-words text-sm text-tx">{run.dailyAction}</p>
              <div className="mt-2"><TodayAction run={run} journey={journey} today={today} /></div>
            </section>
          </div>

          <section aria-labelledby={`pq-days-${run.id}`}>
            <h3 id={`pq-days-${run.id}`} className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-mu">{j.calendarTitle}</h3>
            <DayGrid journey={journey} today={today} />
          </section>

          {run.status !== "abandoned" && <ChapterBlock run={run} today={today} />}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Diary run={run} journey={journey} today={today} />
            <MarkHistory journey={journey} />
          </div>

          <section className="rounded-xl border border-line bg-s2/40 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{j.info}</h3>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
              {rows.map(([key, label, value]) => (
                <div key={key}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{label}</dt>
                  <dd className="mt-0.5 break-words text-tx" data-testid={`pq-detail-${key}`}>{value}</dd>
                </div>
              ))}
            </dl>
            <h4 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-mu">{d.rewards}</h4>
            <div className="mt-1.5"><RewardTable verification={run.verification} testId="pq-detail-rewards" /></div>
            <p className="mt-3 text-xs text-mu" data-testid="pq-progress-soon">{d.progressSoon}</p>
          </section>
        </div>
      </Modal>
      <Modal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        title={p.path.abandon.title}
        closeLabel={p.path.abandon.cancel}
        size="sm"
        data-testid="pq-abandon-confirm"
        footer={
          <>
            <button type="button" className={buttonClasses("secondary")} onClick={() => setConfirming(false)} data-testid="pq-abandon-cancel">
              {p.path.abandon.cancel}
            </button>
            <button type="button" className={buttonClasses("danger")} onClick={abandon} data-testid="pq-abandon-confirm-yes">
              {p.path.abandon.confirm}
            </button>
          </>
        }
      >
        <p className="text-sm text-tx">{formatString(p.path.abandon.text, { title: run.title })}</p>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </Modal>
    </>
  );
}

/** Abandoned (and later completed) runs: their path stays readable; an abandoned quest can start again at once (В-22). */
function RunHistory({ runs, allRuns, onOpen }: { runs: PQRun[]; allRuns: PQRun[]; onOpen: (id: string) => void }) {
  const { dict, lang, showToast } = useApp();
  const { gameState, gameDay, restartPersonalQuest } = useGame();
  const p = dict.personalQuests;
  const h = p.path.history;
  const ids = useRef<Record<string, string>>({});
  const busy = useRef(false);
  const fmt = (k: string) => formatDayKey(k, lang, { day: "numeric", month: "short" });
  const tz = gameState.profile?.timezone;
  const live = activeRuns(allRuns, gameDay);
  const restart = async (run: PQRun) => {
    if (busy.current) return;
    busy.current = true;
    // one new id per restarted run: a second click sends the same request, never a second run
    const newId = (ids.current[run.id] ??= newPqId("pq"));
    try {
      const res = await restartPersonalQuest(run.id, newId);
      if (res.ok) showToast(h.restarted);
      else showToast(errorText(dict, res.reason));
    } finally {
      busy.current = false;
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" aria-labelledby="pq-history-title" data-testid="pq-history">
      <h3 id="pq-history-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{h.title}</h3>
      {runs.length === 0 ? (
        <p className="mt-2 text-sm text-mu">{h.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line/60">
          {runs.map((r) => {
            const to = r.abandonedAt ? dayKeyInZone(new Date(r.abandonedAt), tz) : endDayOf(r);
            // the quest runs again (or the newest run of it is this one's restart): no second restart button
            const running = live.some((x) => x.questId === r.questId);
            const newest = allRuns.find((x) => x.questId === r.questId) === r;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="pq-history-item" data-run={r.id} data-status={r.status}>
                <CategoryIcon category={r.category} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold text-tx">{r.title}</div>
                  <div className="text-xs text-mu">
                    {p.categories[r.category].name} · {formatString(h.period, { from: fmt(r.startDay), to: fmt(to) })}
                    {r.restartOf ? ` · ${h.repeat}` : ""}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-s2 px-2 py-0.5 text-[11px] font-semibold text-mu" data-testid="pq-history-status">
                  {r.status === "completed" && <Check size={11} aria-hidden="true" />}
                  {r.status === "completed" ? h.completed : h.abandoned}
                </span>
                <VerificationLabel verification={r.verification} />
                <button type="button" className={buttonClasses("ghost", "md")} onClick={() => onOpen(r.id)} aria-label={formatString(p.path.journey.openAria, { title: r.title })} data-testid="pq-history-open">
                  {p.path.journey.open}
                </button>
                {r.status === "abandoned" && !running && newest && (
                  <button type="button" className={buttonClasses("secondary", "md")} onClick={() => restart(r)} aria-label={formatString(h.restartAria, { title: r.title })} data-testid="pq-restart">
                    <RotateCcw size={14} aria-hidden="true" />
                    {h.restart}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ the rail */

export function PathRail() {
  const { dict } = useApp();
  const r = dict.personalQuests.path.rail;
  return (
    <>
      <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="pq-rules">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{r.rulesTitle}</h3>
        <ul className="mt-2 divide-y divide-line/60 text-sm text-tx">
          {r.rules.map((rule) => (
            <li key={rule} className="flex gap-2.5 py-2">
              <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
              {rule}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="pq-rail-rewards">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{r.rewardsTitle}</h3>
        <div className="mt-2"><RewardTable /></div>
        <p className="mt-2 text-xs text-mu">{dict.personalQuests.path.wizard.noCoins}</p>
      </section>
      <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="pq-local">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-tx">
          <HardDrive size={15} aria-hidden="true" className="text-mu" />
          {r.localTitle}
        </h3>
        <p className="mt-1 text-xs text-mu">{r.localText}</p>
      </section>
      <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="pq-creators-soon">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-tx">
          <Clock size={15} aria-hidden="true" className="text-[#e5b98a]" />
          {r.creatorsTitle}
        </h3>
        <p className="mt-1 text-xs text-mu">{r.creatorsText}</p>
      </section>
    </>
  );
}
