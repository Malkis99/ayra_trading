"use client";

import React from "react";
import { BookOpen, LineChart, Moon, Sprout } from "lucide-react";
import { useApp } from "@/lib/context";
import { DAY_MODES, type DayMode } from "@/lib/quest-engine";
import { cn } from "@/components/ui/cn";

const ICONS: Record<DayMode, typeof Moon> = { trading: LineChart, study: BookOpen, rest: Moon, recovery: Sprout };

/** The four day modes. A mode that cannot be chosen now stays visible with the reason (no silent dead buttons). */
export function ModeSwitch({ mode, locked, busy, backMode, onChange }: { mode: DayMode; locked: boolean; busy: boolean; backMode?: DayMode; onChange: (m: DayMode) => void }) {
  const { dict } = useApp();
  const t = dict.questsPage.q2.modes;
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={t.title} className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-s1 p-1.5 sm:grid-cols-4" data-testid="mode-switch">
        {DAY_MODES.map((m) => {
          const Icon = ICONS[m];
          const selected = m === mode;
          // after a reward only «rest» and the mode before it stay open (lib/game.ts: setDayMode decides on fresh data);
          // the others stay clickable and say why (the hint below and a message), so no button is silently dead
          const unavailable = locked && !selected && m !== "rest" && !(mode === "rest" && m === backMode);
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-describedby={unavailable ? "mode-hint" : undefined}
              data-testid={`mode-${m}`}
              disabled={busy}
              onClick={() => onChange(m)}
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                selected ? "bg-vi/15 text-tx ring-1 ring-inset ring-vi" : unavailable ? "text-mu/60" : "text-mu hover:bg-s2 hover:text-tx"
              )}
            >
              <Icon size={16} aria-hidden="true" />
              {t[m]}
            </button>
          );
        })}
      </div>
      <p id="mode-hint" className="text-xs text-mu">{locked ? t.locked : t.hint}</p>
    </div>
  );
}
