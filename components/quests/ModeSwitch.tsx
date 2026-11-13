"use client";

import React, { useRef } from "react";
import { BookOpen, LineChart, Moon, Sprout } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { DAY_MODES, type DayMode } from "@/lib/quest-engine";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

const ICONS: Record<DayMode, typeof Moon> = { trading: LineChart, study: BookOpen, rest: Moon, recovery: Sprout };

/**
 * The four day modes as tabs (docs/quests-ux-3.0-plan.md, 6): opening a tab only shows that mode's quests; the active
 * mode (dot) changes only with «Make active», which is always available. Viewing never changes anything.
 */
export function ModeSwitch({
  active,
  viewed,
  busy,
  onView,
  onActivate,
}: {
  active: DayMode;
  viewed: DayMode;
  busy: boolean;
  onView: (m: DayMode) => void;
  onActivate: (m: DayMode) => void;
}) {
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
    <div className="space-y-2">
      <div role="tablist" aria-label={t.title} className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-s1 p-1.5 sm:grid-cols-4" data-testid="mode-switch">
        {DAY_MODES.map((m, i) => {
          const Icon = ICONS[m];
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
              tabIndex={selected ? 0 : -1}
              data-testid={`mode-${m}`}
              data-active={isActive ? "true" : "false"}
              onClick={() => onView(m)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                selected ? "bg-vi/15 text-tx ring-1 ring-inset ring-vi" : "text-mu hover:bg-s2 hover:text-tx"
              )}
            >
              <Icon size={16} aria-hidden="true" />
              {t[m]}
              {isActive && (
                <>
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
                  <span className="sr-only">({t.active})</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-mu">{t.hint}</p>
      {viewed !== active && (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-vi/45 bg-vi/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="mode-viewing">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-tx">{formatString(t.viewing, { mode: t[viewed] })}</p>
            <p className="mt-0.5 text-xs text-mu">{t.activateNote}</p>
          </div>
          <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => onActivate(viewed)} data-testid="mode-activate" className="shrink-0">
            {t.activate}
          </Button>
        </div>
      )}
    </div>
  );
}
