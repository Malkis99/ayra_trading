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
import { CATEGORY_LOOK, questTitle, questWhy } from "./quest-text";

export interface QuestCardProps {
  quest: QuestTemplate;
  done: boolean;
  /** The quest shown instead of another one today. */
  replacedFromTitle?: string;
  busy?: boolean;
  replaceUsed: number;
  replaceMax: number;
  onComplete: () => void;
  onPass: () => void;
  onReplace: () => void;
  compact?: boolean;
  /** Why it is not done yet (from the journal), shown under the quest. */
  reason?: string;
  /** A quest of a mode that is only being viewed: shown, but it cannot be ticked here. */
  readOnly?: boolean;
  /** Put off for today («not today» or replaced): kept in its place, without actions. */
  passed?: boolean;
  /** Done in another mode earlier today and kept in its slot. */
  carriedLabel?: string;
  /** Journal quests: the exact place in the journal and the button text for it. */
  journalHref?: string;
  journalCta?: string;
}

/** One quest: what it is, why, how it is confirmed, what it gives, and its actions (all with visible labels). */
export function QuestCard({ quest, done, replacedFromTitle, busy, replaceUsed, replaceMax, onComplete, onPass, onReplace, compact, reason, readOnly, passed, carriedLabel, journalHref, journalCta }: QuestCardProps) {
  const { dict, lang } = useApp();
  const t = dict.questsPage.q1.card;
  const title = questTitle(dict, lang, quest);
  const why = questWhy(dict, lang, quest);
  const look = CATEGORY_LOOK[quest.category];
  const Icon = look.icon;
  const appClosed = APP_CLOSED_QUESTS.has(quest.id);
  const reward = questReward(quest);
  const rewardText =
    reward.coins > 0
      ? formatString(dict.questsPage.todayTab.rewardXpCoins, { xp: reward.xp, coins: reward.coins })
      : formatString(dict.questsPage.todayTab.rewardXp, { xp: reward.xp });

  const [whyOpen, setWhyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const whyId = useId();
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);


  return (
    <article
      data-testid={`quest-card-${quest.id}`}
      data-done={done ? "true" : "false"}
      data-passed={passed && !done ? "true" : undefined}
      className={cn(
        "relative grid grid-cols-[44px_minmax(0,1fr)] gap-x-3.5 gap-y-3 rounded-lg border p-4 transition-colors sm:grid-cols-[44px_minmax(0,1fr)_auto]",
        done ? "border-success/25 bg-gradient-to-r from-success/[0.07] to-s1 to-40%" : passed ? "border-line bg-s1/60 opacity-75" : "border-line bg-s1 hover:border-vi/50"
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-11 w-11 place-items-center [clip-path:polygon(25%_0,75%_0,100%_25%,100%_75%,75%_100%,25%_100%,0_75%,0_25%)]"
        style={{ color: look.color, backgroundColor: `${look.color}24` }}
      >
        <Icon size={19} />
      </span>

      <div className="min-w-0">
        <h3 className="break-words text-sm font-bold text-tx">{title}</h3>
        {replacedFromTitle && (
          <p className="mt-0.5 text-xs text-mu">{formatString(t.replacedFrom, { title: replacedFromTitle })}</p>
        )}
        {!compact && <p className="mt-0.5 text-[13px] text-mu">{dict.categories[quest.category]} · {formatString(t.minutes, { n: quest.durationMinutes })}</p>}
        {carriedLabel && (
          <p className="mt-0.5 text-xs font-semibold text-vi" data-testid="quest-carried">
            {carriedLabel}
          </p>
        )}
        {!done && !passed && reason && (
          <p className="mt-1 text-xs text-mu" data-testid="quest-reason">
            <span className="font-semibold text-tx/80">{dict.questsPage.q2.reasonLabel}</span> {reason}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <VerificationBadge source={appClosed ? "journal" : "self"} label={appClosed ? t.badgeJournal : t.badgeSelf} />
          <span className="whitespace-nowrap rounded-full bg-s2 px-2.5 py-0.5 text-xs font-semibold text-tx">{rewardText}</span>
        </div>
        {!compact && (
          <>
            <button
              type="button"
              aria-expanded={whyOpen}
              aria-controls={whyId}
              onClick={() => setWhyOpen((v) => !v)}
              className="mt-2 inline-flex min-h-[36px] items-center rounded-md text-xs font-semibold text-vi hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              {whyOpen ? t.whyHide : t.whyShow}
            </button>
            {whyOpen && (
              <p id={whyId} className="rounded-md bg-s2/60 p-2.5 text-[13px] text-mu">
                {why}
              </p>
            )}
          </>
        )}
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:justify-end sm:self-center">
        {done ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-success" data-testid="quest-done">
            <Check size={16} aria-hidden="true" />
            {t.done}
          </span>
        ) : passed ? (
          <span className="text-sm font-semibold text-mu" data-testid="quest-passed">
            {dict.questsPage.q2.passed}
          </span>
        ) : appClosed ? (
          <>
            <span className="text-xs text-mu" data-testid="quest-auto-closes">
              {dict.questsPage.todayTab.autoCloses}
            </span>
            <Link href={journalHref || JOURNAL_LINK[quest.id] || "/journal"} className={buttonClasses("secondary", "sm")} data-testid="quest-journal-link">
              {journalCta || dict.questsPage.q1.today.noTradeCta}
            </Link>
          </>
        ) : readOnly ? (
          <span className="text-xs text-mu" data-testid="quest-preview-only">
            {dict.questsPage.q2.modes.previewOnly}
          </span>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={onComplete} aria-busy={busy || undefined}>
            {busy ? t.saving : dict.questsPage.todayTab.completeBtn}
          </Button>
        )}

        {!done && !passed && !readOnly && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={formatString(t.moreActions, { title })}
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-11 w-11 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div id={menuId} className="absolute right-0 top-12 z-20 w-56 rounded-md border border-line bg-s1 p-1 shadow-float">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPass();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-sm text-tx hover:bg-s2"
                >
                  <XCircle size={16} aria-hidden="true" className="text-mu" />
                  {t.notToday}
                </button>
                {!appClosed && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      onReplace();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-sm text-tx hover:bg-s2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw size={16} aria-hidden="true" className="text-mu" />
                    {formatString(t.replace, { used: replaceUsed, max: replaceMax })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
