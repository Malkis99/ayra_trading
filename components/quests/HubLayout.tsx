"use client";

import React, { useRef } from "react";
import { cn } from "@/components/ui/cn";

export type HubTab = "today" | "week" | "history" | "creators";
export const HUB_TABS: HubTab[] = ["today", "week", "history", "creators"];

export function parseHubTab(value: string | null | undefined): HubTab {
  return HUB_TABS.includes(value as HubTab) ? (value as HubTab) : "today";
}

/**
 * The four top-level tabs of the Quest Hub (docs/quest-hub-plan.md 1). They switch the whole content below; on a phone
 * the four share the row equally (no horizontal scrolling), the small badges hide below 400px.
 */
export function HubTabs({
  value,
  onChange,
  label,
  items,
}: {
  value: HubTab;
  onChange: (tab: HubTab) => void;
  label: string;
  items: Array<{ id: HubTab; label: string; badge?: React.ReactNode }>;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusAt = (index: number) => {
    const next = (index + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  };
  return (
    <div role="tablist" aria-label={label} className="flex border-b border-line md:gap-2" data-testid="hub-tabs">
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`quests-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`quests-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            data-testid={`hub-tab-${item.id}`}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              const keys: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 };
              if (!(e.key in keys)) return;
              e.preventDefault();
              focusAt(keys[e.key]);
            }}
            className={cn(
              "relative inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-1 text-sm font-semibold transition-colors md:flex-none md:px-3.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
              selected ? "text-tx after:bg-vi" : "text-mu after:bg-transparent hover:text-tx"
            )}
          >
            {item.label}
            {item.badge && <span className="hidden min-[400px]:inline-flex">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A tab's two columns: the main working column and the progress rail (340px from 1280, 380px from 1680). Below 1280
 * the rail goes under the main column, two cards a row on a tablet, one on a phone.
 */
export function HubColumns({ main, rail, railLabel }: { main: React.ReactNode; rail: React.ReactNode; railLabel: string }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-5 min-[1680px]:grid-cols-[minmax(0,1fr)_380px] min-[1680px]:gap-6">
      <div className="min-w-0">{main}</div>
      <aside aria-label={railLabel} className="grid min-w-0 items-start gap-3 md:max-xl:grid-cols-2" data-testid="hub-rail">
        {rail}
      </aside>
    </div>
  );
}
