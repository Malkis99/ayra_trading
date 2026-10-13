"use client";

import React, { forwardRef, useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "../cn";
import { Field, describedBy, fieldClasses, useFormsText } from "./field";
import { Popover, useOutsideClose } from "./popover";

export type AutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  /** Recently used values, listed first under "Recent". */
  recent?: string[];
  /** Other suggestions. */
  suggestions?: readonly string[];
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  maxItems?: number;
  autoFocus?: boolean;
  "data-testid"?: string;
};

/** Free text field with a suggestion list (recent first); arrows + Enter pick a suggestion. */
export const Autocomplete = forwardRef<HTMLInputElement, AutocompleteProps>(function Autocomplete(
  {
    value,
    onChange,
    recent = [],
    suggestions = [],
    label,
    hint,
    error,
    optional,
    placeholder,
    disabled,
    className,
    inputClassName,
    id: idProp,
    maxItems = 8,
    autoFocus,
    "data-testid": testId,
  },
  ref
) {
  const { t } = useFormsText();
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const items = useMemo(() => {
    const q = value.trim().toUpperCase();
    const seen = new Set<string>();
    const out: Array<{ value: string; group: "recent" | "suggestions" }> = [];
    const add = (v: string, group: "recent" | "suggestions") => {
      const key = v.toUpperCase();
      if (seen.has(key) || (q && !key.includes(q)) || key === q) return;
      seen.add(key);
      out.push({ value: v, group });
    };
    recent.forEach((v) => add(v, "recent"));
    suggestions.forEach((v) => add(v, "suggestions"));
    return out.slice(0, maxItems);
  }, [value, recent, suggestions, maxItems]);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);
  useOutsideClose([wrapRef, panelRef], open, close);

  const pick = (v: string) => {
    onChange(v);
    close();
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => (items.length ? (a + 1) % items.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : -1));
    } else if (e.key === "Enter" && open && active >= 0 && items[active]) {
      e.preventDefault();
      pick(items[active].value);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  };

  const showList = open && items.length > 0;
  let lastGroup: string | undefined;

  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <div ref={wrapRef}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          autoComplete="off"
          autoFocus={autoFocus}
          data-testid={testId}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={fieldClasses({ invalid: Boolean(error), className: inputClassName })}
        />
      </div>
      <Popover anchor={wrapRef} open={showList} panelRef={panelRef} preferredHeight={300}>
        <ul id={listId} role="listbox" className="overflow-y-auto p-1.5">
          {items.map((it, i) => {
            const heading = it.group !== lastGroup ? (it.group === "recent" ? t.recent : t.suggestions) : null;
            lastGroup = it.group;
            return (
              <React.Fragment key={it.value}>
                {heading && (
                  <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-mu">
                    {heading}
                  </li>
                )}
                <li
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerMove={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(it.value)}
                  className={cn("flex min-h-[40px] cursor-pointer items-center rounded-[9px] px-3 text-sm font-medium text-tx", i === active && "bg-s2")}
                >
                  {it.value}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </Popover>
    </Field>
  );
});
