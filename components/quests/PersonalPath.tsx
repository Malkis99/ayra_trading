"use client";

import React, { useRef, useState } from "react";
import { Brain, Check, Clock, Dumbbell, GraduationCap, HardDrive, LineChart, Plus, Repeat, RotateCcw, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { dayKeyInZone } from "@/lib/day-key";
import {
  PQ_MAX_ACTIVE,
  PQ_PERIOD_DAYS,
  PQ_RANKS,
  PQ_RANK_DAYS,
  PQ_RANK_XP,
  activeRuns,
  dayNumber,
  daysLeft,
  endDayOf,
  phaseOf,
  type PQCategoryId,
  type PQRank,
  type PQRun,
  type PQVerification,
} from "@/lib/personal-quests";
import { Modal } from "@/components/ui/Modal";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { formatDayKey } from "./WeekTab";
import { PersonalQuestWizard } from "./PersonalQuestWizard";

// QH-8.2 «My path»: personal 30-day quests — start, view, abandon, restart. Nothing here gives XP or Coins: the rewards
// are shown as a future reward (variant C), daily marks and the final report come in QH-8.3 / QH-8.4.

export const CATEGORY_ICONS: Record<PQCategoryId, LucideIcon> = {
  discipline: ShieldCheck,
  physical: Dumbbell,
  learning: GraduationCap,
  psychology: Brain,
  trading: LineChart,
  habits: Repeat,
};

/** A new id for a run or a quest (stable once made: the same request is never saved twice). */
export function newPqId(prefix: "pq" | "pqq"): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  const raw = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${raw.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** The category sign: a violet tile with its icon. */
export function CategoryIcon({ category, size = "md" }: { category: PQCategoryId; size?: "sm" | "md" }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl border border-vi/30 bg-vi/10 text-vi", size === "md" ? "h-11 w-11" : "h-8 w-8")} aria-hidden="true">
      <Icon size={size === "md" ? 20 : 16} />
    </span>
  );
}

/** The verification label: a self-report always says so in words, never only by colour. */
export function VerificationLabel({ verification }: { verification: PQVerification }) {
  const { dict } = useApp();
  return (
    <span
      data-testid="pq-verification"
      data-verification={verification}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", verification === "app" ? "border-success/40 bg-success/10 text-success" : "border-line bg-s2 text-mu")}
    >
      {dict.personalQuests.verification[verification]}
    </span>
  );
}

/** Rewards by rank (variant C): one column for a verification, or both. Shown as a future reward — nothing is given here. */
export function RewardTable({ verification, testId = "pq-rewards" }: { verification?: PQVerification; testId?: string }) {
  const { dict } = useApp();
  const p = dict.personalQuests;
  const cols: PQVerification[] = verification ? [verification] : ["app", "self"];
  const ranks = [...PQ_RANKS].reverse();
  const range = (r: PQRank) => (r === "gold" ? `${PQ_RANK_DAYS.gold}–${PQ_PERIOD_DAYS}` : r === "silver" ? `${PQ_RANK_DAYS.silver}–${PQ_RANK_DAYS.gold - 1}` : `${PQ_RANK_DAYS.bronze}–${PQ_RANK_DAYS.silver - 1}`);
  return (
    <table className="w-full text-sm" data-testid={testId}>
      {!verification && (
        <thead>
          <tr className="text-left text-[11px] text-mu">
            <th scope="col" className="pb-1 font-semibold" />
            <th scope="col" className="pb-1 text-right font-semibold">{p.path.rail.rewardsApp}</th>
            <th scope="col" className="pb-1 text-right font-semibold">{p.path.rail.rewardsSelf}</th>
          </tr>
        </thead>
      )}
      <tbody className="divide-y divide-line/60">
        {ranks.map((r) => (
          <tr key={r} data-rank={r}>
            <th scope="row" className="py-1.5 text-left font-medium text-tx">
              {formatString(p.path.rankRow, { rank: p.ranks[r], days: range(r) })}
            </th>
            {cols.map((v) => (
              <td key={v} className={cn("py-1.5 text-right font-semibold", r === "gold" ? "text-go" : "text-tx")} data-testid={`pq-xp-${r}-${v}`}>
                {formatString(p.path.rankXp, { xp: PQ_RANK_XP[v][r] })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function errorText(dict: ReturnType<typeof useApp>["dict"], reason?: string): string {
  const e = dict.personalQuests.path.errors as Record<string, string>;
  return (reason && e[reason]) || e.notSaved;
}

/* ------------------------------------------------------------------ the main column */

export function PathMain() {
  const { dict, showToast } = useApp();
  const { gameState, gameDay } = useGame();
  const p = dict.personalQuests.path;
  const runs = gameState.personalRuns ?? [];
  const active = activeRuns(runs, gameDay);
  const past = runs.filter((r) => !active.includes(r));
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const openRun = active.find((r) => r.id === openRunId) ?? null;
  const full = active.length >= PQ_MAX_ACTIVE;

  return (
    <div className="space-y-4" data-testid="pq-main">
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
              <RunCard run={r} today={gameDay} onOpen={() => setOpenRunId(r.id)} />
            </li>
          ))}
        </ul>
      )}

      <RunHistory runs={past} allRuns={runs} />

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
      {openRun && <RunDetails run={openRun} today={gameDay} onClose={() => setOpenRunId(null)} />}
    </div>
  );
}

/** One active run: what it is, which day, how it is confirmed, what it may give at the end. */
function RunCard({ run, today, onOpen }: { run: PQRun; today: string; onOpen: () => void }) {
  const { dict } = useApp();
  const p = dict.personalQuests;
  const c = p.path.card;
  const n = dayNumber(run, today);
  const left = daysLeft(run, today);
  const over = phaseOf(run, today) === "awaitingReport";
  const AchIcon = CATEGORY_ICONS[run.category];
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-s1 p-4 transition-colors hover:border-vi/50" data-testid="pq-card" data-run={run.id} data-category={run.category}>
      <div className="flex items-start gap-3">
        <CategoryIcon category={run.category} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-mu">{p.categories[run.category].name}</div>
          <h3 className="break-words font-serif text-lg font-bold leading-snug text-tx" data-testid="pq-card-title">{run.title}</h3>
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="font-serif text-base font-bold text-tx" data-testid="pq-card-day" data-day={n}>
          {formatString(c.day, { n })}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-mu" data-testid="pq-card-left" data-left={left}>
          <Clock size={12} aria-hidden="true" />
          {over ? c.periodOver : left === 1 ? c.lastDay : formatString(c.left, { n: left })}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-s2" aria-hidden="true">
        <div className="h-full rounded-full bg-vi/70 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${(n / PQ_PERIOD_DAYS) * 100}%` }} />
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{c.action}</dt>
          <dd className="break-words text-tx" data-testid="pq-card-action">{run.dailyAction}</dd>
        </div>
      </dl>

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
        <button type="button" className={buttonClasses("secondary", "md")} onClick={onOpen} aria-label={formatString(c.detailsAria, { title: run.title })} data-testid="pq-card-open">
          {c.details}
        </button>
      </div>
    </article>
  );
}

/** The details of an active run, and abandoning it (with a confirmation). */
function RunDetails({ run, today, onClose }: { run: PQRun; today: string; onClose: () => void }) {
  const { dict, lang, showToast } = useApp();
  const { abandonPersonalQuest } = useGame();
  const p = dict.personalQuests;
  const d = p.path.details;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
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
        subtitle={`${p.categories[run.category].name} · ${formatString(p.path.card.day, { n: dayNumber(run, today) })}`}
        closeLabel={d.close}
        size="lg"
        sheetOnMobile
        data-testid="pq-details"
        footer={
          <>
            <button type="button" className={buttonClasses("danger")} onClick={() => setConfirming(true)} data-testid="pq-abandon">
              {d.abandon}
            </button>
            <button type="button" className={buttonClasses("secondary")} onClick={onClose}>
              {d.close}
            </button>
          </>
        }
      >
        <dl className="space-y-3 text-sm">
          {rows.map(([key, label, value]) => (
            <div key={key}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{label}</dt>
              <dd className="mt-0.5 break-words text-tx" data-testid={`pq-detail-${key}`}>{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mu">{d.verification}</dt>
            <dd className="mt-1"><VerificationLabel verification={run.verification} /></dd>
          </div>
        </dl>
        <div className="mt-4 rounded-xl border border-line bg-s2/50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{d.rewards}</h3>
          <div className="mt-1.5"><RewardTable verification={run.verification} testId="pq-detail-rewards" /></div>
        </div>
        <p className="mt-3 text-xs text-mu" data-testid="pq-progress-soon">{d.progressSoon}</p>
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

/** Abandoned (and later completed) runs. An abandoned quest can start again at once as a new run (В-22). */
function RunHistory({ runs, allRuns }: { runs: PQRun[]; allRuns: PQRun[] }) {
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
