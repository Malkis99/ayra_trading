"use client";

import React, { useId, useRef } from "react";
import { Check, Star, X } from "lucide-react";
import { cn } from "../cn";
import { Field, describedBy, useFormsText } from "./field";
import { formatString } from "@/lib/i18n";

type GroupProps = {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  className?: string;
  disabled?: boolean;
};

/* ---------------------------------- Segmented ---------------------------------- */

export type SegmentTone = "neutral" | "long" | "short" | "accent";
export type SegmentOption<T extends string> = { value: T; label: React.ReactNode; tone?: SegmentTone; icon?: React.ReactNode };

const SEGMENT_SELECTED: Record<SegmentTone, string> = {
  neutral: "bg-s2 text-tx border-mu/50",
  accent: "bg-pri text-white border-pri",
  long: "bg-long/15 text-long border-long",
  short: "bg-short/15 text-short border-short",
};

/** One-of-N choice shown as joined buttons (radio group semantics, arrow keys move the choice). */
export function Segmented<T extends string>({
  label,
  hint,
  error,
  optional,
  className,
  disabled,
  options,
  value,
  onChange,
  size = "md",
  name,
}: GroupProps & {
  options: SegmentOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  size?: "md" | "lg";
  name?: string;
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };
  const selectedIndex = options.findIndex((o) => o.value === value);
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={className} asGroup>
      <div
        role="radiogroup"
        aria-label={typeof label === "string" ? label : name}
        aria-describedby={describedBy(id, hint, error)}
        className="grid gap-1.5 rounded-md border border-edge bg-field p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (selectedIndex === -1 && i === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-[9px] border text-sm font-semibold transition-colors",
                size === "lg" ? "min-h-[48px]" : "min-h-[40px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-50",
                selected ? SEGMENT_SELECTED[o.tone ?? "accent"] : "border-transparent text-mu hover:bg-s2 hover:text-tx"
              )}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/* ------------------------------- Chip multiselect ------------------------------- */

export type ChipTone = "accent" | "danger" | "success";
export type ChipOption = { value: string; label: React.ReactNode };

const CHIP_SELECTED: Record<ChipTone, string> = {
  accent: "border-vi bg-vi/20 text-tx",
  danger: "border-short bg-short/15 text-short",
  success: "border-long bg-long/15 text-long",
};

/** Many-of-N choice as chips: a selected chip is filled and shows a check mark. */
export function ChipMultiSelect({
  label,
  hint,
  error,
  optional,
  className,
  disabled,
  options,
  value,
  onChange,
  tone = "accent",
}: GroupProps & {
  options: ChipOption[];
  value: string[];
  onChange: (value: string[]) => void;
  tone?: ChipTone;
}) {
  const id = useId();
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={className} asGroup>
      <div className="flex flex-wrap gap-2" aria-describedby={describedBy(id, hint, error)}>
        {options.map((o) => {
          const selected = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => toggle(o.value)}
              className={cn(
                "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-50",
                selected ? cn(CHIP_SELECTED[tone], "font-semibold") : "border-edge bg-field text-mu hover:border-mu/60 hover:text-tx"
              )}
            >
              {selected && <Check size={14} strokeWidth={3} aria-hidden="true" />}
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/* ---------------------------------- StarRating ---------------------------------- */

/** 1–5 rating; arrow keys change it, clicking the current star again clears it. */
export function StarRating({
  label,
  hint,
  error,
  optional,
  className,
  disabled,
  value,
  onChange,
}: GroupProps & { value: number; onChange: (value: number) => void }) {
  const id = useId();
  const { t } = useFormsText();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const set = (n: number) => {
    const next = Math.max(1, Math.min(5, n));
    onChange(next);
    refs.current[next - 1]?.focus();
  };
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={className} asGroup>
      <div className="flex items-center gap-1">
        <div role="radiogroup" aria-label={typeof label === "string" ? label : undefined} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = value >= n;
            return (
              <button
                key={n}
                ref={(el) => {
                  refs.current[n - 1] = el;
                }}
                type="button"
                role="radio"
                aria-checked={value === n}
                aria-label={formatString(t.ratingValue, { value: n })}
                tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(value === n ? 0 : n)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    set((value || 0) + 1);
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    set((value || 2) - 1);
                  }
                }}
                className={cn(
                  "grid h-11 w-11 place-items-center rounded-md transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50",
                  filled ? "text-amber-300" : "text-mu/60 hover:text-mu"
                )}
              >
                <Star size={24} fill={filled ? "currentColor" : "none"} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {value > 0 && !disabled && (
          <button
            type="button"
            onClick={() => onChange(0)}
            aria-label={t.clearRating}
            className="grid h-9 w-9 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </Field>
  );
}

/* ------------------------------- Toggle / Checkbox ------------------------------- */

type BoolProps = {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** On/off switch with a visible label (role="switch"). */
export function Toggle({ label, description, checked, onChange, disabled, className }: BoolProps) {
  const id = useId();
  return (
    <div className={cn("flex min-h-[44px] items-center justify-between gap-4", className)}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-tx">{label}</span>
        {description && <span className="block text-xs text-mu">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "border-pri bg-pri" : "border-edge bg-field"
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-5 w-5 rounded-full shadow transition-transform",
            checked ? "translate-x-[22px] bg-white" : "translate-x-[3px] bg-mu"
          )}
        />
      </button>
    </div>
  );
}

/** Checkbox with a large tap area and a clear checked state. */
export function Checkbox({ label, description, checked, onChange, disabled, className }: BoolProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "group flex min-h-[44px] cursor-pointer items-start gap-3 py-2",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span className="relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-5 w-5 cursor-pointer appearance-none rounded-[6px] border-2 border-edge bg-field transition-colors checked:border-pri checked:bg-pri hover:border-mu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed"
        />
        <Check
          size={14}
          strokeWidth={3}
          aria-hidden="true"
          className="pointer-events-none relative text-white opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-tx">{label}</span>
        {description && <span className="block text-xs text-mu">{description}</span>}
      </span>
    </label>
  );
}
