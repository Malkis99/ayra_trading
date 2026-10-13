"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "../cn";
import { useFormsText } from "./field";
import { Popover, useOutsideClose } from "./popover";
import { formatString } from "@/lib/i18n";

export type FilterOption = { value: string; label: string };

type Props = {
  /** Filter name, e.g. "Account". */
  name: string;
  options: FilterOption[];
  /** Selected value or null when the filter is off. */
  value: string | null;
  onChange: (value: string | null) => void;
  clearLabel: string;
  "data-testid"?: string;
};

/**
 * Compact filter as a chip: shows "Name" when off and "Name: value" (filled) when on,
 * opens a small list (with search for long lists); the × clears it.
 */
export function FilterChip({ name, options, value, onChange, clearLabel, "data-testid": testId }: Props) {
  const { t } = useFormsText();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useOutsideClose([wrapRef, panelRef], open, close);

  const withSearch = options.length > 7;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === value) ?? null;

  const openList = () => {
    setOpen(true);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    requestAnimationFrame(() => (withSearch ? searchRef.current : listRef.current)?.focus());
  };
  const pick = (o: FilterOption | undefined) => {
    if (!o) return;
    onChange(o.value);
    close();
    btnRef.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      btnRef.current?.focus();
    } else if (e.key === "Tab") {
      close();
    }
  };

  return (
    <div ref={wrapRef} className="inline-flex shrink-0">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        data-value={value ?? ""}
        onClick={() => (open ? close() : openList())}
        className={cn(
          "inline-flex min-h-[40px] items-center gap-1.5 border text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
          selected ? "rounded-l-full border-vi bg-vi/15 pl-3.5 pr-2 font-semibold text-tx" : "rounded-full border-edge bg-field px-3.5 text-mu hover:border-mu/60 hover:text-tx"
        )}
      >
        <span>{selected ? `${name}: ${selected.label}` : name}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {selected && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={formatString(clearLabel, { name })}
          className="inline-flex min-h-[40px] items-center rounded-r-full border border-l-0 border-vi bg-vi/15 pl-1.5 pr-2.5 text-tx hover:bg-vi/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
      <Popover anchor={wrapRef} open={open} panelRef={panelRef} minWidth={220} preferredHeight={320}>
        {withSearch && (
          <div className="border-b border-line p-2">
            <div className="relative">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
                className="min-h-[40px] w-full rounded-md border border-edge bg-field pl-9 pr-3 text-sm text-tx placeholder:text-mu/70 focus:border-vi focus:outline-none"
              />
            </div>
          </div>
        )}
        <ul ref={listRef} role="listbox" aria-label={name} tabIndex={-1} onKeyDown={withSearch ? undefined : onKeyDown} className="overflow-y-auto p-1.5 focus:outline-none">
          {filtered.length === 0 && <li className="px-3 py-5 text-center text-sm text-mu">{t.noResults}</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onPointerMove={() => setActive(i)}
              onClick={() => pick(o)}
              className={cn("flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[9px] px-3 text-sm text-tx", i === active && "bg-s2", o.value === value && "font-semibold")}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check size={16} strokeWidth={3} className="text-vi" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}
