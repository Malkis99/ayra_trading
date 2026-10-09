"use client";

import React from "react";
import { useApp } from "@/lib/context";

export function Toast() {
  const { toastMessage, toastActionLabel, onToastAction, showToast } = useApp();

  if (!toastMessage) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-vi bg-s2 px-4 py-2.5 text-xs font-medium text-tx shadow-2xl md:bottom-6 flex items-center gap-3">
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
