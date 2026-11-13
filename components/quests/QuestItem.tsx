"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check, MoreHorizontal, RotateCcw, XCircle } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { APP_CLOSED_QUESTS, questReward, type QuestTemplate } from "@/lib/quests";
import { JOURNAL_LINK } from "@/lib/quests-view";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { VerificationBadge } from "./VerificationBadge";
import { CATEGORY_LOOK, questTitle } from "./quest-text";

export interface QuestItemProps {
  quest: QuestTemplate;
  /** «tile»: one of the three missions of the day; «row»: an extra quest further down. */
  variant: "tile" | "row";
  /** Slot number of a mission (1–3). */
  slot?: number;
  done: boolean;
  passed?: boolean;
  /** A quest of a mode that is only being viewed: shown, it cannot be ticked here. */
  readOnly?: boolean;
  /** The next step of the day: its button is the primary one. */
  emphasize?: boolean;
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

/** One quest: short title, a short line, how it is confirmed, what it gives and one clear action. */
export function QuestItem(props: QuestItemProps) {
  const { quest, variant, slot, done, passed, readOnly, emphasize, carriedLabel, replacedFromTitle, journalHref, journalCta, busy } = props;
  const { dict, lang } = useApp();
  const c = dict.questsPage.q1.card;
  const p = dict.questsPage.q2.page;
  const title = questTitle(dict, lang, quest);
  const look = CATEGORY_LOOK[quest.category];
  const Icon = look.icon;
  const appClosed = APP_CLOSED_QUESTS.has(quest.id);
  const reward = questReward(quest);
  const rewardText = reward.coins > 0 ? formatString(dict.questsPage.todayTab.rewardXpCoins, { xp: reward.xp, coins: reward.coins }) : formatString(dict.questsPage.todayTab.rewardXp, { xp: reward.xp });
  const tile = variant === "tile";
  const canAct = !done && !passed && !readOnly;

  const action = done ? (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success" data-testid="quest-done">
      <Check size={16} aria-hidden="true" />
      {c.done}
    </span>
  ) : passed ? (
    <span className="text-sm font-semibold text-mu" data-testid="quest-passed">
      {p.passed}
    </span>
  ) : appClosed ? (
    <Link href={journalHref || JOURNAL_LINK[quest.id] || "/journal"} data-testid="quest-journal-link" className={buttonClasses(emphasize ? "primary" : "secondary", "sm", tile ? "w-full" : "")}>
      {journalCta || p.go}
    </Link>
  ) : readOnly ? (
    <span className="text-xs text-mu" data-testid="quest-preview-only">
      {p.preview}
    </span>
  ) : (
    <Button data-action="main" variant={emphasize ? "primary" : "secondary"} size="sm" disabled={busy} aria-busy={busy || undefined} onClick={props.onComplete} className={tile ? "w-full" : ""}>
      {busy ? c.saving : dict.questsPage.todayTab.completeBtn}
    </Button>
  );

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mu">
      <VerificationBadge source={appClosed ? "journal" : "self"} label={appClosed ? p.journal : p.self} />
      <span className="font-semibold text-tx/80">{rewardText}</span>
    </div>
  );

  const notes = (
    <>
      {carriedLabel && (
        <p className="text-xs font-semibold text-vi" data-testid="quest-carried">
          {carriedLabel}
        </p>
      )}
      {replacedFromTitle && <p className="text-xs text-mu">{formatString(c.replacedFrom, { title: replacedFromTitle })}</p>}
    </>
  );

  if (!tile) {
    return (
      <article data-testid={`quest-card-${quest.id}`} data-done={done ? "true" : "false"} data-passed={passed && !done ? "true" : undefined} className={cn("flex items-center gap-3 py-3", passed && !done && "opacity-70")}>
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ color: look.color, backgroundColor: `${look.color}1f` }}>
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-tx">{title}</h3>
          {notes}
          <div className="mt-1">{meta}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {canAct && <ActionsMenu {...props} title={title} appClosed={appClosed} />}
        </div>
      </article>
    );
  }

  return (
    <article
      data-testid={`quest-card-${quest.id}`}
      data-done={done ? "true" : "false"}
      data-passed={passed && !done ? "true" : undefined}
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-2xl border p-4 transition-colors",
        done ? "border-success/30 bg-success/[0.05]" : emphasize ? "border-vi/60 bg-gradient-to-b from-vi/[0.10] to-s1" : "border-line bg-s1",
        passed && !done && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          aria-hidden="true"
          className={cn("grid h-7 w-7 place-items-center rounded-full text-xs font-bold", done ? "bg-success text-ink" : "bg-s2 text-mu ring-1 ring-line")}
        >
          {done ? <Check size={14} /> : slot}
        </span>
        {canAct ? <ActionsMenu {...props} title={title} appClosed={appClosed} /> : <span className="h-9" aria-hidden="true" />}
      </div>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-snug text-tx">{title}</h3>
        <p className="mt-0.5 text-xs text-mu">
          {dict.categories[quest.category]} · {formatString(c.minutes, { n: quest.durationMinutes })}
        </p>
        <div className="mt-1 space-y-0.5">{notes}</div>
      </div>
      {meta}
      <div className="mt-auto">{action}</div>
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
        className="grid h-9 w-9 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="absolute right-0 top-10 z-20 w-56 rounded-md border border-line bg-s1 p-1 shadow-float">
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
