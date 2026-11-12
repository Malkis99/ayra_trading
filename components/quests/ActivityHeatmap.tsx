"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import type { DayCell } from "@/lib/quests-view";
import { cn } from "@/components/ui/cn";
import { formatDayKey } from "./WeekTab";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type Look = "high" | "mid" | "low" | "rest" | "shield" | "none" | "noData" | "beforeStart" | "future" | "today";

function lookOf(d: DayCell): Look {
  if (d.status === "done") return d.quests >= 3 ? "high" : d.quests === 2 ? "mid" : "low";
  return d.status;
}

const CELL: Record<Look, string> = {
  high: "bg-[#8d6fd0]",
  mid: "bg-[#6b52a8]",
  low: "bg-[#4a3a78]",
  rest: "border-[1.5px] border-[#7fcfa6]/60",
  shield: "border-[1.5px] border-vi/70",
  none: "bg-s2",
  noData: "border border-dashed border-edge",
  beforeStart: "bg-white/[0.03]",
  future: "bg-white/[0.03]",
  today: "border border-vi",
};

/** Quests done per day over 4 weeks, from the saved history — not a discipline score. */
export function ActivityHeatmap({ grid }: { grid: DayCell[][] }) {
  const { dict, lang } = useApp();
  const d = dict.questsPage.q1.discipline;
  const legend = d.legend;
  const statusLabel = (c: DayCell) => {
    const l = lookOf(c);
    if (l === "future") return dict.questsPage.q1.week.status.future;
    if (l === "today") return dict.questsPage.q1.week.status.today;
    return legend[l];
  };

  return (
    <div>
      <div className="grid grid-cols-[28px_repeat(7,minmax(0,40px))] gap-1.5" role="table" aria-label={d.activityTitle} data-testid="activity-grid">
        <span role="row" className="contents">
          <span />
          {WEEKDAY_KEYS.map((k) => (
            <span key={k} role="columnheader" className="text-center text-xs text-mu">
              {dict.questsPage.weekTab.days[k]}
            </span>
          ))}
        </span>
        {grid.map((week) => (
          <span key={week[0].key} role="row" className="contents">
            <span role="rowheader" className="self-center text-xs text-mu">{formatDayKey(week[0].key, lang, { day: "numeric" })}</span>
            {week.map((c) => (
              <span
                key={c.key}
                role="cell"
                data-testid="activity-cell"
                data-status={c.status}
                data-quests={c.quests}
                aria-label={formatString(d.cellLabel, { date: formatDayKey(c.key, lang), status: statusLabel(c) })}
                title={formatString(d.cellLabel, { date: formatDayKey(c.key, lang), status: statusLabel(c) })}
                className={cn("aspect-square rounded-[5px]", CELL[lookOf(c)])}
              />
            ))}
          </span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-mu">
        {(["high", "mid", "low", "rest", "shield", "none", "noData", "beforeStart"] as const).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("inline-block h-3 w-3 rounded-[3px]", CELL[k])} />
            {legend[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}
