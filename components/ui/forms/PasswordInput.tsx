"use client";

import React, { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field, describedBy, fieldClasses } from "./field";
import type { BaseFieldProps } from "./Input";

export type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> &
  BaseFieldProps & {
    showLabel: string;
    hideLabel: string;
  };

/** Password field with a «show password» eye button. Browser password managers work via `autoComplete`. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, hint, error, optional, labelAction, containerClassName, className, id: idProp, showLabel, hideLabel, ...rest },
  ref
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [visible, setVisible] = useState(false);
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} labelAction={labelAction} className={containerClassName}>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={fieldClasses({ invalid: Boolean(error), className: `pr-11 ${className ?? ""}` })}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-1 my-auto grid h-9 w-9 place-items-center rounded-lg text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </Field>
  );
});
