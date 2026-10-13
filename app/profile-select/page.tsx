"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect-whitelist";
import {
  copyGuestToAccount,
  isAccountOnboarded,
  setProfileChoice,
  shouldOfferProfileSelect,
  summarizeSpace,
  type SpaceSummary,
} from "@/lib/storage/profile-transfer";
import { validateAvatarAppearance, type AvatarAppearance } from "@/lib/avatar";
import { Character } from "@/components/Character";
import { formatNumber, formatString } from "@/lib/i18n";
import { AlertCircle, ArrowRight, Clock, Loader2, X } from "lucide-react";

type Busy = null | "copy" | "fresh" | "later";

export default function ProfileSelectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dict, lang } = useApp();
  const t = dict.profileSelect;
  const { authState, user, profile } = useAuth();
  const nextDestination = sanitizeRedirectUrl(searchParams.get("next"), "/");

  const [summary, setSummary] = useState<SpaceSummary | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [failedAttachments, setFailedAttachments] = useState(0);
  const decidedRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (authState === "loading" || decidedRef.current) return;
    if (authState !== "authenticated" || !user) {
      router.replace("/");
      return;
    }
    // Offered only after onboarding: a new account always starts with its own /awakening.
    if (!isAccountOnboarded(user.id)) {
      router.replace("/awakening");
      return;
    }
    if (!shouldOfferProfileSelect(user.id)) {
      router.replace(nextDestination);
      return;
    }
    setSummary(summarizeSpace(null));
  }, [authState, user, router, nextDestination]);

  useEffect(() => {
    if (summary) titleRef.current?.focus();
  }, [summary]);

  const handleUseProfile = async () => {
    if (!user || busy) return;
    decidedRef.current = true;
    setBusy("copy");
    setError(null);
    try {
      const result = await copyGuestToAccount(user.id, { nickname: profile?.nickname });
      setProfileChoice(user.id, "copied");
      if (result.failedAttachments > 0) {
        setFailedAttachments(result.failedAttachments);
        setPendingDestination(nextDestination);
        setBusy(null);
        return;
      }
      router.replace(nextDestination);
    } catch {
      decidedRef.current = false;
      setError(t.copyError);
      setBusy(null);
    }
  };

  const handleStartFresh = () => {
    if (!user || busy) return;
    decidedRef.current = true;
    setBusy("fresh");
    setProfileChoice(user.id, "fresh");
    router.replace(nextDestination);
  };

  const handleDecideLater = () => {
    if (busy) return;
    decidedRef.current = true;
    setBusy("later");
    router.replace(nextDestination);
  };

  if (!summary) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-ink text-mu">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const nickname = summary.nickname || t.noNickname;

  return (
    <div className="min-h-screen w-full overflow-y-auto bg-ink text-tx">
      <header className="flex h-14 items-center border-b border-line/40 px-4 md:px-8">
        <span className="font-serif text-lg font-bold tracking-wider">AYRA</span>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-6 md:py-10">
        <div className="space-y-2 text-center">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="font-serif text-2xl font-bold leading-tight focus:outline-none md:text-3xl"
          >
            {t.title}
          </h1>
          <p className="text-sm text-mu">{t.subtitle}</p>
        </div>

        <section
          aria-label={t.guestLabel}
          className="flex items-center gap-4 rounded-2xl border border-vi/40 bg-s1/80 p-4 shadow-xl shadow-vi/10"
        >
          <div className="grid h-24 w-16 flex-none place-items-center rounded-xl bg-s2/60">
            <Character
              appearance={validateAvatarAppearance(summary.appearance as Partial<AvatarAppearance> | null)}
              equipment={summary.equipment}
              size="mini"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-mu">{t.guestLabel}</div>
            <div className="truncate font-serif text-xl font-bold">{nickname}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-mu">
              <span className="rounded-md border border-vi/40 bg-pri/30 px-2 py-0.5 font-serif font-semibold text-tx">
                {formatString(t.levelLabel, { level: formatNumber(lang, summary.level) })}
              </span>
              <span>{formatString(t.tradesLabel, { count: formatNumber(lang, summary.tradesCount) })}</span>
            </div>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"
          >
            <AlertCircle size={16} className="shrink-0 text-red-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {pendingDestination ? (
          <div className="space-y-3" aria-live="polite">
            <div className="rounded-xl border border-go/30 bg-go/10 p-3 text-xs text-go">
              {formatString(t.attachmentsWarning, { count: formatNumber(lang, failedAttachments) })}
            </div>
            <button
              type="button"
              onClick={() => router.replace(pendingDestination)}
              className="btn flex w-full items-center justify-center gap-2 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <span>{dict.awakening.continue}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleUseProfile}
                disabled={busy !== null}
                aria-describedby="profile-select-use-hint"
                className="btn flex w-full items-center justify-center gap-2 py-3 text-sm shadow-md shadow-vi/20 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                {busy === "copy" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    <span>{t.copying}</span>
                  </>
                ) : (
                  <>
                    <span>{t.useProfileBtn}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
              <p id="profile-select-use-hint" className="px-1 text-xs text-mu">
                {t.useProfileHint}
              </p>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleStartFresh}
                disabled={busy !== null}
                aria-describedby="profile-select-fresh-hint"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-s2/70 py-3 text-sm font-semibold text-tx transition hover:border-vi/50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                <X size={16} aria-hidden="true" />
                <span>{t.startFreshBtn}</span>
              </button>
              <p id="profile-select-fresh-hint" className="px-1 text-xs text-mu">
                {t.startFreshHint}
              </p>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleDecideLater}
                disabled={busy !== null}
                aria-describedby="profile-select-later-hint"
                className="btn-ghost flex w-full items-center justify-center gap-2 py-3 text-sm text-mu hover:text-tx disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                <Clock size={16} aria-hidden="true" />
                <span>{t.decideLaterBtn}</span>
              </button>
              <p id="profile-select-later-hint" className="px-1 text-xs text-mu">
                {t.decideLaterHint}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
