"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * All tabs in one row. When the row does not fit (phones) it scrolls horizontally without a visible
 * scrollbar, the active tab is scrolled into view and soft edge gradients hint that there is more.
 * 44px tap targets, arrow-key navigation, a clearly highlighted active tab.
 */
export function Tabs<T extends string>({ items, value, onChange, label, className, idPrefix = "tabs" }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateEdges, items.length]);

  // Keep the active tab fully visible, clear of the edge gradients (phones, or after navigation via ?tab=)
  const activeIndex = items.findIndex((i) => i.id === value);
  useEffect(() => {
    const list = scrollRef.current;
    const tab = refs.current[activeIndex];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const pad = 32;
    const left = tab.offsetLeft - pad;
    const right = tab.offsetLeft + tab.offsetWidth + pad;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
    updateEdges();
  }, [activeIndex, updateEdges]);

  const focusAt = (index: number) => {
    const next = (index + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  };

  return (
    <div className={cn("relative border-b border-line", className)}>
      <div
        ref={scrollRef}
        role="tablist"
        aria-label={label}
        onScroll={updateEdges}
        className="relative flex gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                } else if (e.key === "Home") {
                  e.preventDefault();
                  focusAt(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  focusAt(items.length - 1);
                }
              }}
              className={cn(
                "relative inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-t-md px-3.5 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi",
                "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
                selected ? "bg-vi/10 font-semibold text-tx after:bg-vi" : "text-mu after:bg-transparent hover:bg-s2/60 hover:text-tx"
              )}
            >
              {item.label}
            </button>
          );
        })}
        {/* end spacer: flex scroll containers ignore end padding, so the last tab could stay partly hidden */}
        <span aria-hidden="true" className="w-2 shrink-0" />
      </div>
      <span
        aria-hidden="true"
        data-edge="left"
        className={cn("pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ink to-transparent transition-opacity", edges.left ? "opacity-100" : "opacity-0")}
      />
      <span
        aria-hidden="true"
        data-edge="right"
        className={cn("pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-ink to-transparent transition-opacity", edges.right ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}
