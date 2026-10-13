"use client";

import React, { useCallback, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { Popover, useOutsideClose } from "./forms/popover";

export type TabEntry<T extends string> = { id: T; label: string; icon?: React.ReactNode };

type Props<T extends string> = {
  primary: TabEntry<T>[];
  more: TabEntry<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  moreLabel: string;
  className?: string;
};

const tabClass = (selected: boolean) =>
  cn(
    "relative inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-t-md px-3.5 text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi",
    "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
    selected ? "bg-vi/10 font-semibold text-tx after:bg-vi" : "text-mu hover:bg-s2/60 hover:text-tx after:bg-transparent"
  );

/**
 * Main tabs plus a "More" menu for rare sections. A section opened from the menu is shown
 * as the selected label on the menu button, so the active place is always visible.
 */
export function TabsWithMore<T extends string>({ primary, more, value, onChange, label, moreLabel, className }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose([moreRef, panelRef], open, close);

  const inMore = more.find((m) => m.id === value);
  const all = [...primary.map((p) => p.id), "__more" as const];

  const focusTab = (index: number) => {
    const next = (index + all.length) % all.length;
    refs.current[next]?.focus();
  };

  const openMenu = () => {
    setOpen(true);
    setActive(Math.max(0, more.findIndex((m) => m.id === value)));
    requestAnimationFrame(() => listRef.current?.focus());
  };

  const pick = (id: T) => {
    onChange(id);
    setOpen(false);
    moreRef.current?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {primary.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected || (inMore && i === 0) ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                focusTab(i + 1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                focusTab(i - 1);
              }
            }}
            className={tabClass(selected)}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
      {more.length > 0 && (
        <>
          <button
            ref={(el) => {
              moreRef.current = el;
              refs.current[primary.length] = el;
            }}
            type="button"
            role="tab"
            aria-selected={Boolean(inMore)}
            aria-haspopup="menu"
            aria-expanded={open}
            tabIndex={inMore ? 0 : -1}
            onClick={() => (open ? setOpen(false) : openMenu())}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openMenu();
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                focusTab(primary.length - 1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                focusTab(0);
              }
            }}
            className={tabClass(Boolean(inMore))}
          >
            {inMore ? inMore.label : moreLabel}
            <ChevronDown size={16} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
          </button>
          <Popover anchor={moreRef as React.RefObject<HTMLElement>} open={open} panelRef={panelRef} minWidth={220} preferredHeight={300}>
            <ul
              ref={listRef}
              role="menu"
              aria-label={moreLabel}
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (a + 1) % more.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + more.length) % more.length);
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(more[active].id);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  moreRef.current?.focus();
                } else if (e.key === "Tab") {
                  setOpen(false);
                }
              }}
              className="p-1.5 focus:outline-none"
            >
              {more.map((m, i) => (
                <li
                  key={m.id}
                  role="menuitemradio"
                  aria-checked={m.id === value}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(m.id)}
                  className={cn(
                    "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[9px] px-3 text-sm text-tx",
                    i === active && "bg-s2",
                    m.id === value && "font-semibold"
                  )}
                >
                  {m.icon && <span className="text-mu">{m.icon}</span>}
                  <span className="flex-1">{m.label}</span>
                  {m.id === value && <Check size={16} strokeWidth={3} className="text-vi" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </Popover>
        </>
      )}
    </div>
  );
}
