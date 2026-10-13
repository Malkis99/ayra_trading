"use client";

import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";

type DrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  closeLabel: string;
  children: React.ReactNode;
  /** Sticky footer (actions). */
  footer?: React.ReactNode;
  /** Desktop width of the side panel. */
  width?: "md" | "lg";
  "data-testid"?: string;
};

const WIDTHS = { md: "md:w-[480px]", lg: "md:w-[580px]" };
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Side panel on the right from 768px, bottom sheet on phones. Focus trap, Esc and backdrop close,
 * focus returns to the opener. Popovers inside stop Esc themselves, so Esc closes them first.
 */
export function Drawer({ isOpen, onClose, title, subtitle, closeLabel, children, footer, width = "lg", "data-testid": testId }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const raf = requestAnimationFrame(() => {
      const autofocus = panel?.querySelector<HTMLElement>("[data-autofocus]");
      (autofocus ?? panel?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel || !panel.contains(document.activeElement)) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  // Portal: a drawer opened from inside <main> must not be trapped in its stacking context.
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] motion-safe:animate-[ayraFade_160ms_ease-out]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className={cn(
          "absolute flex flex-col border-edge bg-s1 shadow-float",
          // phone: bottom sheet
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t motion-safe:animate-[ayraSheetUp_220ms_ease-out]",
          // tablet/desktop: right panel
          "md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:rounded-none md:rounded-l-2xl md:border-l md:border-t-0 md:motion-safe:animate-[ayraSlideIn_220ms_ease-out]",
          WIDTHS[width]
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-edge md:hidden" aria-hidden="true" />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-3 md:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-serif text-xl font-bold text-tx">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-mu">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-s1 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

type SectionProps = {
  title: React.ReactNode;
  /** Short summary shown when collapsed, e.g. "2 filled". */
  summary?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  id?: string;
};

/** Accordion section for long forms (one button per section, aria-expanded). */
export function FormSection({ title, summary, open, onToggle, children, icon, id: idProp }: SectionProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <section className="rounded-lg border border-line bg-ink/40">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={onToggle}
          className="flex min-h-[52px] w-full items-center gap-3 rounded-lg px-4 text-left hover:bg-s2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi"
        >
          {icon && <span className="shrink-0 text-vi">{icon}</span>}
          <span className="flex-1 text-sm font-semibold text-tx">{title}</span>
          {summary && !open && <span className="text-xs font-medium text-mu">{summary}</span>}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={cn("shrink-0 text-mu transition-transform", open && "rotate-180")}>
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>
      {open && (
        <div id={`${id}-panel`} className="space-y-4 border-t border-line px-4 pb-4 pt-4">
          {children}
        </div>
      )}
    </section>
  );
}
