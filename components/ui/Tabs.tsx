"use client";

import React, { useRef } from "react";
import { cn } from "./cn";

export type TabItem<T extends string> = { id: T; label: React.ReactNode };

type TabsProps<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  /** Prefix for tab/panel ids; panels should use id={`${idPrefix}-panel-${id}`}. */
  idPrefix?: string;
};

/** Underlined tabs: 44px tap targets, horizontal scroll without a visible scrollbar, arrow-key navigation. */
export function Tabs<T extends string>({ items, value, onChange, label, className, idPrefix = "tabs" }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAt = (index: number) => {
    const next = (index + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                focusAt(index + 1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                focusAt(index - 1);
              }
            }}
            className={cn(
              "-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi",
              selected ? "border-vi font-semibold text-tx" : "border-transparent text-mu hover:text-tx"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
