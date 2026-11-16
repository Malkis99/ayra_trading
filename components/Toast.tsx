"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useApp } from "@/lib/context";

export function Toast() {
  const { toastMessage, toastActionLabel, onToastAction, toastLevel, dismissToast, dict } = useApp();

  if (!toastMessage) return null;

  if (toastLevel === "risk") {
    // a trading-risk warning: read out at once, stays longer, closed by the person or by its time (never by a reward)
    return (
      <div
        role="alert"
        data-testid="toast"
        data-level="risk"
        className="fixed bottom-20 left-1/2 z-[130] flex w-[calc(100%-32px)] max-w-md -translate-x-1/2 items-start gap-2.5 rounded-xl border border-danger/70 bg-s2 px-4 py-3 text-sm font-medium text-tx shadow-2xl md:bottom-6 md:w-auto"
      >
        <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        <span className="min-w-0 flex-1">
          <span className="sr-only">{dict.common.riskToastLabel}: </span>
          <span>{toastMessage}</span>
        </span>
        <button
          type="button"
          onClick={dismissToast}
          aria-label={dict.common.toastClose}
          data-testid="toast-close"
          className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-mu hover:text-tx focus-visible:outline focus-visible:outline-2 focus-visible:outline-vi"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    // above open windows (trade card z-[100], lightbox z-[120]): «Undo» must stay clickable while a card is open
    <div role="status" aria-live="polite" data-testid="toast" data-level="info" className="fixed bottom-20 left-1/2 z-[130] -translate-x-1/2 rounded-xl border border-vi bg-s2 px-4 py-2.5 text-xs font-medium text-tx shadow-2xl md:bottom-6 flex items-center gap-3">
      <span>{toastMessage}</span>
      {toastActionLabel && onToastAction && (
        <button
          onClick={() => {
            onToastAction();
          }}
          className="btn-primary text-[11px] py-1 px-2.5 font-bold flex-none shadow-md"
        >
          {toastActionLabel}
        </button>
      )}
    </div>
  );
}
