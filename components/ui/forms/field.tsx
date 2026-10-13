"use client";

import React from "react";
import { AlertCircle } from "lucide-react";
import { useOptionalApp } from "@/lib/context";
import { getDictionary } from "@/lib/i18n";
import { cn } from "../cn";

/** Texts for shared form components; falls back to Russian outside AppProvider (tests). */
export function useFormsText() {
  const app = useOptionalApp();
  return { t: (app?.dict ?? getDictionary("ru")).forms, lang: app?.lang ?? "ru" };
}

/** Visual states shared by every text-like control. */
export function fieldClasses({ invalid, className }: { invalid?: boolean; className?: string } = {}) {
  return cn(
    "w-full min-h-[44px] rounded-md border bg-field px-3 text-sm text-tx transition-colors",
    "placeholder:text-mu/70 hover:border-mu/60",
    "focus:outline-none focus:border-vi focus:ring-2 focus:ring-vi/30",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-edge",
    invalid ? "border-danger ring-2 ring-danger/25 hover:border-danger" : "border-edge",
    className
  );
}

export type FieldProps = {
  id: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  /** Small action at the right of the label, e.g. "Now". */
  labelAction?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  /** For groups (segmented, chips, rating): renders a fieldset with a legend instead of a label. */
  asGroup?: boolean;
};

export const hintId = (id: string) => `${id}-hint`;
export const errorId = (id: string) => `${id}-error`;

/** aria-describedby value for a control inside <Field>. */
export function describedBy(id: string, hint?: React.ReactNode, error?: React.ReactNode): string | undefined {
  const ids = [error ? errorId(id) : null, hint ? hintId(id) : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({ id, label, hint, error, optional, labelAction, className, children, asGroup }: FieldProps) {
  const { t } = useFormsText();
  const labelContent = label && (
    <>
      {label}
      {optional && <span className="ml-1.5 text-xs font-normal text-mu">({t.optional})</span>}
    </>
  );
  const Wrapper = asGroup ? "fieldset" : "div";
  return (
    <Wrapper
      className={cn("min-w-0 space-y-1.5", className)}
      aria-describedby={asGroup ? describedBy(id, hint, error) : undefined}
    >
      {(label || labelAction) && (
        <div className="flex min-h-[20px] items-center justify-between gap-2">
          {asGroup ? (
            <legend className="float-left text-sm font-medium text-tx">{labelContent}</legend>
          ) : (
            <label htmlFor={id} className="text-sm font-medium text-tx">
              {labelContent}
            </label>
          )}
          {labelAction}
        </div>
      )}
      <div className={asGroup ? "clear-both" : undefined}>{children}</div>
      {error ? (
        <p id={errorId(id)} className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId(id)} className="text-xs text-mu">
          {hint}
        </p>
      ) : null}
    </Wrapper>
  );
}

/** Small text button for label actions ("Now", "Clear"). */
export function LabelAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-xs font-semibold text-vi hover:bg-vi/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
    >
      {children}
    </button>
  );
}
