"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { Popover, useOutsideClose } from "@/components/ui/forms/popover";
import { cn } from "@/components/ui";

// One hint open at a time on the whole page
let openId: string | null = null;
const listeners = new Set<() => void>();
const setOpenId = (id: string | null) => {
  openId = id;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Phones: a bottom sheet instead of a floating panel. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

/**
 * «?» with a short text (PR 1.1c): a floating panel over the page (never moves or resizes anything), a bottom sheet
 * on phones. A tap outside or Esc closes it; opening another hint closes this one.
 */
export function InfoPopover({ id, label, closeLabel, children, testId }: { id: string; label: string; closeLabel: string; children: React.ReactNode; testId: string }) {
  const current = useSyncExternalStore(subscribe, () => openId, () => null);
  const open = current === id;
  const narrow = useNarrow();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (openId === id) setOpenId(null);
  }, [id]);
  useOutsideClose([button, panel], open, close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
      button.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  // closed when it leaves the page
  useEffect(() => () => close(), [close]);

  const panelId = `${id}-panel`;
  const body = (
    <div className="space-y-2 p-3 text-xs leading-snug text-mu" data-testid={`${testId}-about`}>
      {children}
    </div>
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpenId(open ? null : id)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        data-testid={`${testId}-hint`}
      >
        <HelpCircle size={15} aria-hidden="true" />
      </button>
      {open && !narrow && (
        <Popover anchor={button} open panelRef={panel} id={panelId} role="dialog" aria-label={label} minWidth={280} preferredHeight={260} className="max-w-[22rem]">
          {body}
        </Popover>
      )}
      {open &&
        narrow &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label={label}
            className={cn("fixed inset-x-0 bottom-0 z-[120] rounded-t-xl border border-edge bg-s1 pb-[env(safe-area-inset-bottom)] shadow-float")}
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-semibold text-tx">{label}</span>
              <button type="button" onClick={close} aria-label={closeLabel} className="grid h-9 w-9 place-items-center rounded-full text-mu hover:text-tx" data-testid={`${testId}-close`}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {body}
          </div>,
          document.body
        )}
    </>
  );
}
