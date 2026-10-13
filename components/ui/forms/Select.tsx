"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "../cn";
import { Field, describedBy, fieldClasses, useFormsText } from "./field";
import { Popover, useOutsideClose } from "./popover";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Options with the same group are listed under a small heading. */
  group?: string;
  disabled?: boolean;
};

export type SelectProps<T extends string> = {
  options: SelectOption<T>[];
  value: T | "" | null | undefined;
  onChange: (value: T) => void;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  labelAction?: React.ReactNode;
  placeholder?: string;
  /** Search box in the list; on by default when there are more than 7 options. */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  "data-testid"?: string;
  /** Accessible name when there is no visible label. */
  "aria-label"?: string;
};

const normalize = (s: string) => s.toLocaleLowerCase().normalize("NFKD");

/**
 * Custom select (not the native one): readable selected value, list with search,
 * full keyboard support (arrows, Home/End, Enter, Esc, type to jump), check mark on the chosen option.
 */
export function Select<T extends string>({
  options,
  value,
  onChange,
  label,
  hint,
  error,
  optional,
  labelAction,
  placeholder,
  searchable,
  disabled,
  className,
  id: idProp,
  "data-testid": testId,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  const { t } = useFormsText();
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const withSearch = searchable ?? options.length > 7;
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter((o) => normalize(`${o.label} ${o.description ?? ""}`).includes(q));
  }, [options, query]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  }, []);
  const closeNoFocus = useCallback(() => close(false), [close]);
  useOutsideClose([triggerRef, panelRef], open, closeNoFocus);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : options.findIndex((o) => !o.disabled));
  };

  // Focus the search box or the list once the panel is mounted.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => (withSearch ? searchRef.current : listRef.current)?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, withSearch]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (open) setActive(filtered.findIndex((o) => !o.disabled));
    // only when the query changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pick = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  const step = (from: number, delta: number) => {
    if (filtered.length === 0) return -1;
    let i = from;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + delta + filtered.length) % filtered.length;
      if (!filtered[i].disabled) return i;
    }
    return from;
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => step(a < 0 ? 0 : a, -1));
        break;
      case "Home":
        if (!withSearch || !query) {
          e.preventDefault();
          setActive(step(-1, 1));
        }
        break;
      case "End":
        if (!withSearch || !query) {
          e.preventDefault();
          setActive(step(0, -1));
        }
        break;
      case "Enter":
        e.preventDefault();
        pick(filtered[active]);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (!withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          const ta = typeahead.current;
          ta.text = now - ta.at > 700 ? e.key : ta.text + e.key;
          ta.at = now;
          const idx = filtered.findIndex((o) => !o.disabled && normalize(o.label).startsWith(normalize(ta.text)));
          if (idx >= 0) setActive(idx);
        }
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openList();
    }
  };

  const activeId = active >= 0 && filtered[active] ? `${id}-opt-${active}` : undefined;
  let lastGroup: string | undefined;

  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} labelAction={labelAction} className={className}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value ?? ""}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKeyDown}
        className={fieldClasses({
          invalid: Boolean(error),
          className: cn("flex items-center gap-2 text-left", open && "border-vi ring-2 ring-vi/30"),
        })}
      >
        {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
        <span className={cn("min-w-0 flex-1 truncate", selected ? "text-tx" : "text-mu/70")}>
          {selected ? selected.label : placeholder ?? t.selectPlaceholder}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-mu transition-transform", open && "rotate-180")} />
      </button>

      <Popover anchor={triggerRef} open={open} panelRef={panelRef}>
        {withSearch && (
          <div className="border-b border-line p-2">
            <div className="relative">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKeyDown}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={activeId}
                className="min-h-[40px] w-full rounded-md border border-edge bg-field pl-9 pr-3 text-sm text-tx placeholder:text-mu/70 focus:border-vi focus:outline-none"
              />
            </div>
          </div>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={withSearch ? -1 : 0}
          aria-activedescendant={withSearch ? undefined : activeId}
          aria-labelledby={id}
          onKeyDown={withSearch ? undefined : onListKeyDown}
          className="min-h-0 flex-1 overflow-y-auto p-1.5 focus:outline-none"
        >
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-mu">{t.noResults}</li>}
          {filtered.map((o, i) => {
            const isSelected = o.value === value;
            const heading = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <React.Fragment key={o.value}>
                {heading && (
                  <li role="presentation" className="px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-mu">
                    {heading}
                  </li>
                )}
                <li
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => !o.disabled && setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[9px] px-3 py-2 text-sm",
                    i === active && "bg-s2",
                    isSelected ? "font-semibold text-tx" : "text-tx/90",
                    o.disabled && "cursor-not-allowed opacity-40"
                  )}
                >
                  {o.icon && <span className="shrink-0">{o.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.description && <span className="block truncate text-xs font-normal text-mu">{o.description}</span>}
                  </span>
                  {isSelected && <Check size={16} strokeWidth={3} aria-hidden="true" className="shrink-0 text-vi" />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </Popover>
    </Field>
  );
}
