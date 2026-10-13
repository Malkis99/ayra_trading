"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useOptionalApp } from "@/lib/context";
import { getDictionary } from "@/lib/i18n";
import { Button, Input, Modal } from "@/components/ui";
import { cn } from "@/components/ui/cn";

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

/** Confirmation dialog on the shared Modal; optional "type the name to confirm" for destructive actions. */
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
  const dict = useOptionalApp()?.dict ?? getDictionary("ru");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [typedValue, setTypedValue] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setTypedValue("");
    // Safe default: focus "Cancel" (not the destructive action)
    const t = setTimeout(() => cancelButtonRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  const isMatchValid = !matchText || typedValue.trim() === matchText.trim();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-md border",
              isDanger ? "border-short/40 bg-short/10 text-short" : "border-amber-400/40 bg-amber-400/10 text-amber-300"
            )}
            aria-hidden="true"
          >
            {isDanger ? <AlertTriangle size={16} /> : <Info size={16} />}
          </span>
          {title}
        </span>
      }
      closeLabel={cancelLabel}
      size="sm"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelButtonRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={isDanger ? "danger" : "primary"} disabled={!isMatchValid} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-sm leading-relaxed text-mu">{description}</div>
        {warningNote && (
          <p className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 flex-none" aria-hidden="true" />
            <span>{warningNote}</span>
          </p>
        )}
        {matchText && (
          <Input
            label={
              <>
                {matchPromptLabel || dict.deviceData.confirmPrompt} <b className="font-semibold text-tx">{matchText}</b>
              </>
            }
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            placeholder={matchTextPlaceholder || matchText}
            autoComplete="off"
          />
        )}
      </div>
    </Modal>
  );
};
