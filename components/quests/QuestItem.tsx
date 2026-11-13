"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, MoreHorizontal, RotateCcw, XCircle } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { APP_CLOSED_QUESTS, questReward, type QuestTemplate } from "@/lib/quests";
import { JOURNAL_LINK } from "@/lib/quests-view";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { VerificationBadge } from "./VerificationBadge";
import { CATEGORY_LOOK, questCriterion, questShortTitle } from "./quest-text";

export interface QuestItemProps {
  quest: QuestTemplate;
  /** «mission»: one of the three missions of the day (a full row); «extra»: a compact row of the extras. */
  variant: "mission" | "extra";
  /** Number of a mission (1–3). */
  slot?: number;
  done: boolean;
  /** Time it was done today (from the day's history), shown on a done mission. */
  doneAt?: string;
  passed?: boolean;
  /** A quest of a mode that is only being viewed: shown, it cannot be ticked here. */
  readOnly?: boolean;
  /** The next step of the day: marked in its own row, its button is the primary one. */
  next?: boolean;
  carriedLabel?: string;
  replacedFromTitle?: string;
  journalHref?: string;
  journalCta?: string;
  busy?: boolean;
  replaceUsed: number;
  replaceMax: number;
  onComplete: () => void;
  onPass: () => void;
  onReplace: () => void;
}

/**
 * One quest of «Today» (docs/quest-hub-plan.md, 4.1): a short title, the criterion «Done when…», how it is confirmed,
 * what it gives and one action. A mission is a row of the main column (on a phone the reward and the button go under
 * a line); an extra is a quieter compact row. A self-report is never shown as a journal check.
 */
export function QuestItem(props: QuestItemProps) {
  const { quest, variant, slot, done, doneAt, passed, readOnly, next, carriedLabel, replacedFromTitle, journalHref, journalCta, busy } = props;
  const { dict, lang } = useApp();
  const c = dict.questsPage.q1.card;
  const p = dict.questsPage.q2.page;
  const m = dict.questsPage.q2.mission;
  const title = questShortTitle(dict, lang, quest);
  const criterion = questCriterion(dict, quest);
  const appClosed = APP_CLOSED_QUESTS.has(quest.id);
  const reward = questReward(quest);
  const rewardText = reward.coins > 0 ? formatString(dict.questsPage.todayTab.rewardXpCoins, { xp: reward.xp, coins: reward.coins }) : formatString(dict.questsPage.todayTab.rewardXp, { xp: reward.xp });
  const mission = variant === "mission";
  const isPassed = !!passed && !done;
  const canAct = !done && !isPassed && !readOnly;
  const size = mission ? "md" : "sm";
  const badge = <VerificationBadge source={appClosed ? "journal" : "self"} label={appClosed ? p.journal : p.self} />;

  const action = done ? null : isPassed ? (
    <span className="text-sm font-semibold text-mu" data-testid="quest-passed">
      {p.passed}
    </span>
  ) : readOnly ? (
    <span className="text-xs text-mu" data-testid="quest-preview-only">
      {mission ? m.viewOnly : p.preview}
    </span>
  ) : appClosed ? (
    <Link href={journalHref || JOURNAL_LINK[quest.id] || "/journal"} data-testid="quest-journal-link" className={buttonClasses(next ? "primary" : "secondary", size, "gap-2 whitespace-nowrap")}>
      {journalCta || p.go}
      {next && <ArrowRight size={16} aria-hidden="true" className="shrink-0" />}
    </Link>
  ) : (
    <Button
      data-action="main"
      data-testid="quest-complete"
      variant={next ? "primary" : "secondary"}
      size={size}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={busy ? undefined : formatString(m.markAria, { title })}
      onClick={props.onComplete}
    >
      {busy ? c.saving : m.mark}
    </Button>
  );

  const notes = (carriedLabel || replacedFromTitle) && (
    <div className="mt-0.5 space-y-0.5">
      {carriedLabel && (
        <p className="text-xs font-semibold text-vi" data-testid="quest-carried">
          {carriedLabel}
        </p>
      )}
      {replacedFromTitle && <p className="text-xs text-mu">{formatString(c.replacedFrom, { title: replacedFromTitle })}</p>}
    </div>
  );

  const doneLine = done && (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-success" data-testid="quest-done">
      <Check size={14} aria-hidden="true" className="shrink-0" />
      {doneAt ? formatString(m.doneAt, { time: doneAt }) : m.done}
    </p>
  );

  const menu = canAct ? <ActionsMenu {...props} title={title} appClosed={appClosed} /> : null;
  const state = done ? "done" : isPassed ? "passed" : readOnly ? "view" : next ? "next" : "open";

  if (!mission) {
    const look = CATEGORY_LOOK[quest.category];
    const Icon = look.icon;
    return (
      <article data-testid={`quest-card-${quest.id}`} data-done={done ? "true" : "false"} data-passed={isPassed ? "true" : undefined} data-state={state} className={cn("flex items-center gap-3 py-2.5", isPassed && "opacity-70")}>
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ color: look.color, backgroundColor: `${look.color}1a` }}>
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          {next && <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-vi">{m.next}</p>}
          <h4 className={cn("text-sm font-semibold leading-snug", done ? "text-mu" : "text-tx")}>{title}</h4>
          {notes}
          {doneLine}
          {!done && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mu">
              {badge}
              <span className="font-semibold text-tx/80">{rewardText}</span>
            </div>
          )}
        </div>
        {(action || menu) && (
          <div className="flex shrink-0 items-center gap-1">
            {action}
            {menu}
          </div>
        )}
      </article>
    );
  }

  return (
    <article
      data-testid={`quest-card-${quest.id}`}
      data-done={done ? "true" : "false"}
      data-passed={isPassed ? "true" : undefined}
      data-state={state}
      aria-current={next ? "step" : undefined}
      className={cn(
        "mission-row rounded-2xl border transition-colors",
        done
          ? "border-line bg-s1/60"
          : next
            ? "border-vi/70 bg-[linear-gradient(100deg,rgb(var(--c-pri)/0.24),rgb(var(--c-pri)/0.07)_55%,transparent)] shadow-[0_12px_32px_-20px_rgb(var(--c-vi)/0.7)]"
            : "border-line bg-s1",
        isPassed && "opacity-70"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "m-num grid h-9 w-9 place-items-center rounded-xl font-serif text-base font-bold sm:h-11 sm:w-11 sm:text-lg",
          done ? "bg-success/[0.12] text-success ring-1 ring-success/35" : next ? "bg-pri text-tx ring-1 ring-vi/70" : "bg-s2 text-mu ring-1 ring-line"
        )}
      >
        {done ? <Check size={18} /> : slot}
      </span>

      <div className="m-body min-w-0">
        {next && <p className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-vi">{m.next}</p>}
        <h3 className={cn("text-[15px] font-semibold leading-snug sm:text-base", done ? "text-tx/80" : "text-tx")}>{title}</h3>
        {!done && criterion && (
          <p className="mt-0.5 text-[13px] leading-snug text-mu" data-testid="quest-criterion">
            <span className="font-semibold text-tx/85">{m.doneWhen}</span> {criterion}
          </p>
        )}
        {notes}
        {done && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-success" data-testid="quest-done">
            <Check size={14} aria-hidden="true" className="shrink-0" />
            {doneAt ? formatString(m.doneAt, { time: doneAt }) : m.done}
            <span className="m-done-reward font-normal text-mu">· {rewardText}</span>
          </p>
        )}
        <div className="m-meta mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mu">
          {badge}
          <span>{formatString(m.minutes, { n: quest.durationMinutes })}</span>
          <span className="m-reward-inline font-semibold text-tx" aria-hidden="true">
            {rewardText}
          </span>
        </div>
      </div>

      <div className="m-foot">
        <span className={cn("m-reward whitespace-nowrap text-sm font-semibold", done ? "text-mu" : "text-tx")} data-testid="quest-reward">
          {rewardText}
        </span>
        {action && <div className="m-action text-right">{action}</div>}
      </div>

      {menu && <div className="m-menu">{menu}</div>}
    </article>
  );
}

function ActionsMenu({ title, appClosed, busy, replaceUsed, replaceMax, onPass, onReplace }: QuestItemProps & { title: string; appClosed: boolean }) {
  const { dict } = useApp();
  const c = dict.questsPage.q1.card;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        aria-label={formatString(c.moreActions, { title })}
        onClick={() => setOpen((v) => !v)}
        className="grid h-10 w-10 place-items-center rounded-lg text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="absolute right-0 top-11 z-20 w-56 rounded-md border border-line bg-s1 p-1 shadow-float">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onPass();
            }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-sm text-tx hover:bg-s2"
          >
            <XCircle size={16} aria-hidden="true" className="text-mu" />
            {c.notToday}
          </button>
          {!appClosed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onReplace();
              }}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-sm text-tx hover:bg-s2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={16} aria-hidden="true" className="text-mu" />
              {formatString(c.replace, { used: replaceUsed, max: replaceMax })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
