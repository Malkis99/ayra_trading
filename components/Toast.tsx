"use client";

import React from "react";
import { useApp } from "@/lib/context";

export function Toast() {
  const { toastMessage } = useApp();

  if (!toastMessage) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-vi bg-s2 px-4 py-2 text-xs font-medium text-tx shadow-2xl md:bottom-6">
      {toastMessage}
    </div>
  );
}
