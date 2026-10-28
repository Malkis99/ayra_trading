"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { cn } from "@/components/ui";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { timeZoneOffsetLabel } from "@/lib/timezones";
import { NEW_YORK, type DisplayChoice } from "@/lib/market/sessions";

/**
 * Display time of the sessions block: New York (default), my zone from the profile, UTC, or another zone from the
 * list (search by city). No fixed «UTC+N» choices.
 */
export function DisplayZonePicker({ value, profileZone, onChange, idPrefix }: { value: DisplayChoice; profileZone: string; onChange: (v: DisplayChoice) => void; idPrefix: string }) {
  const { dict } = useApp();
  const t = dict.market.sessions.display;
  const options: { kind: DisplayChoice["kind"]; label: string }[] = [
    { kind: "newyork", label: t.newyork },
    { kind: "profile", label: `${t.profile} · ${timeZoneOffsetLabel(profileZone)}` },
    { kind: "utc", label: t.utc },
    { kind: "zone", label: t.other },
  ];
  return (
    <div className="space-y-2" data-testid={`${idPrefix}-display`}>
      <div role="radiogroup" aria-label={t.label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.kind === o.kind;
          return (
            <button
              key={o.kind}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.kind === "zone" ? { kind: "zone", zone: value.kind === "zone" ? value.zone : NEW_YORK } : ({ kind: o.kind } as DisplayChoice))}
              className={cn(
                "min-h-[44px] rounded-full border px-3 sm:min-h-[36px] text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                on ? "border-vi bg-pri/30 text-tx" : "border-line bg-s2 text-mu hover:text-tx"
              )}
              data-testid={`${idPrefix}-display-${o.kind}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {value.kind === "zone" && (
        <TimezoneSelect id={`${idPrefix}-display-zone`} label={t.pick} value={value.zone} onChange={(zone) => onChange({ kind: "zone", zone })} />
      )}
    </div>
  );
}
