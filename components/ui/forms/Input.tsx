"use client";

import React, { forwardRef, useId } from "react";
import { cn } from "../cn";
import { Field, describedBy, fieldClasses, useFormsText } from "./field";
import { formatString } from "@/lib/i18n";

export type BaseFieldProps = {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  labelAction?: React.ReactNode;
  containerClassName?: string;
};

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> &
  BaseFieldProps & {
    /** Shown inside the field on the left (icon or unit such as "$"). */
    leading?: React.ReactNode;
    /** Shown inside the field on the right (unit such as "R" or "%"). */
    trailing?: React.ReactNode;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional, labelAction, containerClassName, leading, trailing, className, id: idProp, ...rest },
  ref
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} labelAction={labelAction} className={containerClassName}>
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-mu">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={fieldClasses({
            invalid: Boolean(error),
            className: cn(leading ? "pl-9" : "", trailing ? "pr-10" : "", className),
          })}
          {...rest}
        />
        {trailing && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-mu">
            {trailing}
          </span>
        )}
      </div>
    </Field>
  );
});

export type NumberUnit = "$" | "R" | "%" | (string & {});

export type NumberInputProps = Omit<InputProps, "type" | "leading" | "trailing" | "inputMode"> & {
  /** Unit shown in the field: "$" on the left, anything else ("R", "%", "lot") on the right. */
  unit?: NumberUnit;
  /** Colours the value: positive green, negative red (results, P&L). */
  signed?: boolean;
};

/** Text field for decimal numbers (keeps the raw string; "," and "." are both accepted by the journal parser). */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { unit, signed, className, value, ...rest },
  ref
) {
  const num = typeof value === "string" ? Number(value.replace(",", ".")) : typeof value === "number" ? value : NaN;
  const tone = signed && Number.isFinite(num) && num !== 0 ? (num > 0 ? "text-long" : "text-short") : "";
  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      leading={unit === "$" ? unit : undefined}
      trailing={unit && unit !== "$" ? unit : undefined}
      className={cn("tabular-nums", tone, className)}
      {...rest}
    />
  );
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & BaseFieldProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, optional, labelAction, containerClassName, className, id: idProp, maxLength, value, rows = 3, ...rest },
  ref
) {
  const { t } = useFormsText();
  const autoId = useId();
  const id = idProp ?? autoId;
  const length = typeof value === "string" ? value.length : 0;
  const counter = maxLength ? formatString(t.charsLeft, { count: length, max: maxLength }) : null;
  const shownHint = hint ?? counter;
  return (
    <Field id={id} label={label} hint={shownHint} error={error} optional={optional} labelAction={labelAction} className={containerClassName}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, shownHint, error)}
        className={fieldClasses({ invalid: Boolean(error), className: cn("py-2.5 leading-relaxed", className) })}
        {...rest}
      />
    </Field>
  );
});
