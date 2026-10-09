"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  warningNote?: string;
  confirmLabel: string;
  cancelLabel: string;
  matchText?: string;
  matchTextPlaceholder?: string;
  matchPromptLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  warningNote,
  confirmLabel,
  cancelLabel,
  matchText,
  matchTextPlaceholder,
  matchPromptLabel,
  isDanger = false,
  onConfirm,
  onCancel,
}) => {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [typedValue, setTypedValue] = useState("");

  // Reset typed value when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTypedValue("");
      // Auto-focus cancel button for safe keyboard navigation
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Esc key listener & Focus Trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isMatchValid = !matchText || typedValue.trim() === matchText.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="card w-full max-w-md space-y-4 shadow-2xl border border-line p-5 relative rounded-2xl bg-s1 animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-xl flex-none ${
              isDanger
                ? "bg-rose-500/15 border border-rose-500/30 text-rose-400"
                : "bg-amber-500/15 border border-amber-500/30 text-amber-300"
            }`}
          >
            {isDanger ? <AlertTriangle size={20} /> : <Info size={20} />}
          </div>

          <div className="space-y-1.5 flex-1 pr-2">
            <h3 id="confirm-dialog-title" className="font-bold text-base text-tx">
              {title}
            </h3>
            <div className="text-xs text-mu leading-relaxed">{description}</div>
          </div>
        </div>

        {warningNote && (
          <div className="p-3 bg-s2/60 border border-line/60 rounded-xl text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle size={14} className="flex-none mt-0.5" />
            <span>{warningNote}</span>
          </div>
        )}

        {matchText && (
          <div className="space-y-1.5 pt-1">
            <label className="text-xs text-mu block font-medium">
              {matchPromptLabel || "To confirm enter:"} <b className="text-tx font-mono">{matchText}</b>
            </label>
            <input
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder={matchTextPlaceholder || matchText}
              className="input text-xs w-full font-mono"
            />
          </div>
        )}

        {/* Separated Action Buttons with spacing on mobile */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-line/50">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="btn-ghost py-2.5 px-4 text-xs font-semibold w-full sm:w-auto"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            disabled={!isMatchValid}
            onClick={onConfirm}
            className={`py-2.5 px-5 text-xs font-semibold rounded-xl transition-all w-full sm:w-auto ${
              !isMatchValid
                ? "bg-s2/80 text-mu border border-line/40 cursor-not-allowed opacity-50"
                : isDanger
                ? "bg-rose-500 text-white hover:bg-rose-600 border border-rose-400/40 shadow-lg shadow-rose-500/20"
                : "btn-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
