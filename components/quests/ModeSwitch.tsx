"use client";

import React, { useRef } from "react";
import { BookOpen, LineChart, Moon, Sprout } from "lucide-react";
import { useApp } from "@/lib/context";
import { DAY_MODES, type DayMode } from "@/lib/quest-engine";
import { cn } from "@/components/ui/cn";

export const MODE_ICONS: Record<DayMode, typeof Moon> = { trading: LineChart, study: BookOpen, rest: Moon, recovery: Sprout };

/**
 * The four day modes as a compact segmented row (docs/quests-ux-3.0-plan.md, 6): a tab only shows that mode; the active
 * mode has a dot. On a phone only the shown mode keeps its label; the others are icons with an accessible name.
 */
export function ModeSwitch({ active, viewed, onView }: { active: DayMode; viewed: DayMode; onView: (m: DayMode) => void }) {
  const { dict } = useApp();
  const t = dict.questsPage.q2.modes;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + DAY_MODES.length) % DAY_MODES.length;
    refs.current[next]?.focus();
    onView(DAY_MODES[next]);
  };

  return (
    <div role="tablist" aria-label={t.title} className="inline-flex w-full rounded-xl border border-line bg-s1 p-1 sm:w-auto" data-testid="mode-switch">
      {DAY_MODES.map((m, i) => {
        const Icon = MODE_ICONS[m];
        const selected = m === viewed;
        const isActive = m === active;
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`mode-tab-${m}`}
            aria-selected={selected}
            aria-controls="mode-panel"
            aria-label={isActive ? `${t[m]} (${t.active})` : t[m]}
            tabIndex={selected ? 0 : -1}
            data-testid={`mode-${m}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => onView(m)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi sm:flex-none",
              selected ? "bg-vi/15 text-tx ring-1 ring-inset ring-vi/60" : "text-mu hover:bg-s2 hover:text-tx"
            )}
          >
            <Icon size={15} aria-hidden="true" />
            <span className={selected ? "" : "hidden sm:inline"} aria-hidden="true">
              {t[m]}
            </span>
            {isActive && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />}
          </button>
        );
      })}
    </div>
  );
}
