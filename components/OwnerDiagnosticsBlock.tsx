"use client";

import React, { useState, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { AppStorage } from "@/lib/storage";
import { ChevronDown, Copy, Check, Terminal } from "lucide-react";

export function OwnerDiagnosticsBlock() {
  const { dict } = useApp();
  const { auth } = dict;
  const { authState, activeSpaceId, lastRouteReason } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const hiddenTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Extract onboarding status safely
  let onboardingStatus = "none";
  if (typeof window !== "undefined") {
    try {
      const raw = AppStorage.getItem("ayra_demo_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.onboarding?.status) {
          onboardingStatus = parsed.onboarding.status;
        }
      }
    } catch {
      // ignore
    }
  }

  const spaceType = activeSpaceId.startsWith("account:") ? "account" : "guest";
  const nowIso = new Date().toISOString();
  const appVersion = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";

  const diagnosticsText = `[AYRA Diagnostics]
AuthState: ${authState}
Space: ${spaceType}
OnboardingStatus: ${onboardingStatus}
LastRouteReason: ${lastRouteReason || "none"}
Timestamp: ${nowIso}
AppVersion: ${appVersion}`;

  const handleCopy = () => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(diagnosticsText)
        .then(() => {
          setCopyToast(true);
          setTimeout(() => setCopyToast(false), 2000);
        })
        .catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
  };

  const fallbackCopy = () => {
    try {
      if (hiddenTextareaRef.current) {
        hiddenTextareaRef.current.value = diagnosticsText;
        hiddenTextareaRef.current.select();
        document.execCommand("copy");
        setCopyToast(true);
        setTimeout(() => setCopyToast(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-xl border border-line/60 bg-ink/40 p-3.5 text-xs">
      <details
        open={isOpen}
        onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
        className="group"
      >
        <summary className="flex items-center justify-between cursor-pointer font-semibold text-tx-muted hover:text-tx select-none">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-violet-glow" />
            <span>{auth.diagnosticsTitle}</span>
          </div>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-tx-muted" />
        </summary>

        <div className="mt-3 space-y-2 border-t border-line/40 pt-3 font-mono text-[11px] text-tx-muted">
          <div className="flex justify-between border-b border-line/20 pb-1">
            <span>{auth.authStateLabel}:</span>
            <span className="font-bold text-violet-glow">{authState}</span>
          </div>
          <div className="flex justify-between border-b border-line/20 pb-1">
            <span>{auth.activeSpaceLabel}:</span>
            <span className="font-bold text-tx">{spaceType}</span>
          </div>
          <div className="flex justify-between border-b border-line/20 pb-1">
            <span>{auth.onboardingStatusLabel}:</span>
            <span className="text-tx">{onboardingStatus}</span>
          </div>
          <div className="flex justify-between border-b border-line/20 pb-1">
            <span>{auth.lastRouteReasonLabel}:</span>
            <span className="text-gold">{lastRouteReason || "none"}</span>
          </div>
          <div className="flex justify-between border-b border-line/20 pb-1">
            <span>{auth.timestampLabel}:</span>
            <span className="text-tx-muted">{nowIso}</span>
          </div>
          <div className="flex justify-between pb-1">
            <span>{auth.appVersionLabel}:</span>
            <span className="text-tx-muted">{appVersion}</span>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 font-sans text-xs text-tx hover:border-violet-glow hover:text-white transition cursor-pointer"
            >
              {copyToast ? <Check className="h-3.5 w-3.5 text-go" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copyToast ? auth.diagnosticsCopied : auth.copyDiagnosticsBtn}</span>
            </button>
          </div>
        </div>
      </details>

      <textarea
        ref={hiddenTextareaRef}
        aria-hidden="true"
        className="sr-only"
        tabIndex={-1}
        readOnly
        defaultValue=""
      />
    </div>
  );
}
