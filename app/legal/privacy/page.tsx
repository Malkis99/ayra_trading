"use client";

import React from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  const { dict } = useApp();
  const { legal } = dict;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Back button */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-tx-muted hover:text-tx transition">
        <ArrowLeft className="h-4 w-4" />
        <span>{dict.profile.back}</span>
      </Link>

      {/* Header */}
      <div>
        <h1 className="font-serif text-3xl font-bold text-tx">{legal.privacyTitle}</h1>
        <p className="mt-1 text-xs text-tx-muted">{legal.lastUpdated.replace("{date}", "2025-01-01")}</p>
      </div>

      {/* Prominent Draft Disclaimer Banner */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">
        <div className="flex items-center gap-2 font-semibold text-amber-300 text-sm mb-1">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{legal.draftDisclaimerTitle}</span>
        </div>
        <p className="text-xs md:text-sm leading-relaxed">{legal.draftDisclaimerText}</p>
      </div>

      {/* Content */}
      <div className="rounded-2xl border border-line bg-card p-6 md:p-8 space-y-4 text-sm text-tx-muted leading-relaxed">
        <p>{legal.privacyContent}</p>
        <p>
          1. <strong>{legal.privacyItem1Title}:</strong> {legal.privacyItem1Text}
        </p>
        <p>
          2. <strong>{legal.privacyItem2Title}:</strong> {legal.privacyItem2Text}
        </p>
        <p>
          3. <strong>{legal.privacyItem3Title}:</strong> {legal.privacyItem3Text}
        </p>
      </div>
    </div>
  );
}
