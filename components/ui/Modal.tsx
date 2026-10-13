"use client";

import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  closeLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Optional line under the title. */
  subtitle?: React.ReactNode;
  "data-testid"?: string;
};

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Centered dialog above everything: focus trap, Esc and backdrop click close, focus returns to the opener. */
export function Modal({ isOpen, onClose, title, closeLabel, children, footer, size = "md", subtitle, "data-testid": testId }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // Popovers and viewers inside handle Esc first and mark it as handled.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  // Portal: dialogs opened from inside <main> must not be trapped in its stacking context.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className={cn("relative flex max-h-[90dvh] w-full flex-col rounded-lg border border-edge bg-s1 shadow-float", SIZES[size])}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-tx">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-mu">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="grid h-11 w-11 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
