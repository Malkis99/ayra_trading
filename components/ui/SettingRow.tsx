"use client";

import React, { useEffect, useId, useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "./cn";

type Props = {
  title: React.ReactNode;
  /** Text of the «?» hint; the same text is used in Settings and in the first-run window. */
  hint: React.ReactNode;
  /** Accessible name of the «?» button, e.g. «Подсказка». */
  hintLabel: string;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
};

/**
 * One setting with a «?» hint (docs/journal-setup-plan.md, section 2).
 * The hint opens on hover, keyboard focus or tap; Esc or a second tap closes it. It sits under the question at full
 * width (never covers buttons or leaves the screen on a phone) and is the group's description for screen readers.
 */
export function SettingRow({ title, hint, hintLabel, children, className, "data-testid": testId }: Props) {
  const titleId = useId();
  const hintId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  // closed by Esc or a second tap while still hovered/focused: stays closed until the pointer or focus leaves
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && (pinned || hovered || focused);
  const close = () => {
    setPinned(false);
    setDismissed(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div role="group" aria-labelledby={titleId} aria-describedby={hintId} className={cn("space-y-2", className)} data-testid={testId}>
      <div className="flex items-center gap-1.5">
        <span id={titleId} className="text-xs font-semibold text-tx">
          {title}
        </span>
        <button
          type="button"
          aria-label={typeof title === "string" ? `${hintLabel}: ${title}` : hintLabel}
          aria-expanded={open}
          aria-controls={hintId}
          // tap / click / Enter pins the hint open; the second one closes it
          onClick={() => {
            if (pinned) close();
            else {
              setDismissed(false);
              setPinned(true);
            }
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => {
            setHovered(false);
            if (!focused) setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setPinned(false);
            setDismissed(false);
          }}
          className="-my-1 grid h-8 w-8 place-items-center rounded-full text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          data-testid={testId ? `${testId}-hint` : undefined}
        >
          <HelpCircle size={15} aria-hidden="true" />
        </button>
      </div>
      <p id={hintId} hidden={!open} className="rounded-lg border border-line bg-s1/80 p-2.5 text-[11px] leading-snug text-mu">
        {hint}
      </p>
      {children}
    </div>
  );
}
