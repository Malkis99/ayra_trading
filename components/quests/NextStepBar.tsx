"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useApp } from "@/lib/context";
import type { NextStep } from "@/lib/quests-view";
import { buttonClasses } from "@/components/ui/Button";
import { questTitle } from "./quest-text";

/**
 * The one next step of the day (moved from the old header to the Today tab). It leads straight to the action: the
 * right block of the day plan or the quest's button.
 */
export function NextStepBar({ next, journalCta, onNextQuest }: { next: NextStep; journalCta?: string; onNextQuest: (questId: string) => void }) {
  const { dict, lang } = useApp();
  const p = dict.questsPage.q2.page;
  const cls = buttonClasses("primary", "md", "min-w-0 w-full justify-between gap-3 text-left sm:w-auto sm:max-w-[420px]");

  let action: React.ReactNode;
  if (next.kind === "quest" || next.kind === "journal") {
    const title = questTitle(dict, lang, next.quest);
    const label = next.kind === "journal" && journalCta ? journalCta : title;
    const inner = (
      <>
        <span className="min-w-0 truncate">{label}</span>
        <ArrowRight size={16} aria-hidden="true" className="shrink-0" />
      </>
    );
    action =
      next.kind === "journal" ? (
        <Link href={next.href} data-testid="hero-next" className={cls} aria-label={`${p.next}: ${label}`}>
          {inner}
        </Link>
      ) : (
        <button type="button" data-testid="hero-next" onClick={() => onNextQuest(next.quest.id)} className={cls} aria-label={`${p.next}: ${label}`}>
          {inner}
        </button>
      );
  } else {
    action = (
      <p data-testid="hero-next" className="px-2 py-1.5 text-sm font-semibold text-tx">
        {next.kind === "rest" ? p.nextRest : p.nextDone}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-vi/30 bg-pri/[0.08] p-2 sm:pl-4" data-testid="next-step">
      <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-mu sm:inline">{p.next}</span>
      {action}
    </div>
  );
}
