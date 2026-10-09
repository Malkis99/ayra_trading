"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { Cloud, X, LogIn } from "lucide-react";

export function GuestBanner() {
  const { isGuest } = useAuth();
  const { dict } = useApp();
  const { guestBanner } = dict;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const isDismissed = localStorage.getItem("ayra_guest_banner_dismissed") === "true";
      setDismissed(isDismissed);
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!isGuest || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem("ayra_guest_banner_dismissed", "true");
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-violet/30 bg-violet/10 p-4 text-tx shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/20 text-violet-glow border border-violet/30">
          <Cloud className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-tx">{guestBanner.title}</h4>
          <p className="text-xs text-tx-muted">{guestBanner.text}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        <Link
          href="/login"
          className="flex items-center gap-1.5 rounded-xl bg-violet px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-glow"
        >
          <LogIn className="h-3.5 w-3.5" />
          <span>{guestBanner.actionBtn}</span>
        </Link>
        <button
          onClick={handleDismiss}
          className="rounded-lg p-1.5 text-tx-muted hover:bg-white/10 hover:text-tx transition cursor-pointer"
          title={guestBanner.dismissBtn}
          aria-label={guestBanner.dismissBtn}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
