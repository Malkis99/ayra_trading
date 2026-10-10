"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { sanitizeRedirectUrl, buildSafeSiteUrlRedirect } from "@/lib/auth/redirect-whitelist";
import { type SanitizedErrorInfo } from "@/lib/auth/error-sanitizer";
import { Mail, KeyRound, ArrowRight, Check, AlertCircle, RefreshCw, Copy, ExternalLink, ChevronDown } from "lucide-react";

export default function LoginPage() {
  const { dict } = useApp();
  const { auth } = dict;
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNextParam = searchParams.get("next");

  const { user, profile, signInWithOtp, verifyOtp, isLoading: authLoading, setGuestDismissed } = useAuth();

  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<SanitizedErrorInfo | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

  const hiddenCopyRef = useRef<HTMLTextAreaElement | null>(null);

  // Site URL mismatch detection
  const [siteUrlMismatch, setSiteUrlMismatch] = useState(false);
  const [mainSiteRedirectUrl, setMainSiteRedirectUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
      if (siteUrl) {
        try {
          const mainOrigin = new URL(siteUrl).origin;
          const currentOrigin = window.location.origin;
          if (currentOrigin !== mainOrigin) {
            setSiteUrlMismatch(true);
            setMainSiteRedirectUrl(buildSafeSiteUrlRedirect(siteUrl, rawNextParam));
          }
        } catch {
          // ignore invalid SITE_URL format
        }
      }
    }
  }, [rawNextParam]);

  // If already logged in, redirect
  useEffect(() => {
    if (!authLoading && user) {
      if (!profile?.nickname) {
        router.replace("/awakening");
      } else {
        const destination = sanitizeRedirectUrl(rawNextParam, "/");
        router.replace(destination);
      }
    }
  }, [user, profile, authLoading, router, rawNextParam]);

  // Resend timer countdown
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleSendCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorKey(null);
    setErrorDetails(null);

    if (!email || !email.includes("@")) {
      setErrorKey("invalidEmail");
      return;
    }

    if (!consentAccepted) {
      setErrorKey("consentRequired");
      return;
    }

    setLoading(true);
    const res = await signInWithOtp(email.trim());
    setLoading(false);

    if (res.success) {
      setStep("otp");
      setResendTimer(60);
    } else {
      setErrorKey(res.errorKey || "genericError");
      if (res.errorDetails) setErrorDetails(res.errorDetails);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorKey(null);
    setErrorDetails(null);

    const cleanCode = otpCode.replace(/\D/g, "");
    if (cleanCode.length < 6 || cleanCode.length > 8) {
      setErrorKey("invalidOrExpiredCode");
      return;
    }

    setLoading(true);
    const res = await verifyOtp(email.trim(), cleanCode, consentAccepted);
    setLoading(false);

    if (res.success) {
      // Redirect handled by useEffect when user state updates
    } else {
      setErrorKey(res.errorKey || "invalidOrExpiredCode");
      if (res.errorDetails) setErrorDetails(res.errorDetails);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0 || loading) return;
    setErrorKey(null);
    setErrorDetails(null);
    setLoading(true);
    const res = await signInWithOtp(email.trim());
    setLoading(false);

    if (res.success) {
      setResendTimer(60);
    } else {
      setErrorKey(res.errorKey || "genericError");
      if (res.errorDetails) setErrorDetails(res.errorDetails);
    }
  };

  const handleCopyTechDetails = () => {
    if (!errorDetails) return;
    const textToCopy = `[AYRA Auth Error]
Time: ${errorDetails.timestamp}
Status: ${errorDetails.status}
Error: ${errorDetails.errorName}
Message: ${errorDetails.sanitizedMessage}${
      errorDetails.urlTruncatedStatus ? `\nSupabase URL Note: ${errorDetails.urlTruncatedStatus}` : ""
    }`;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          setCopyToast(auth.techDetails.copied);
          setTimeout(() => setCopyToast(null), 2500);
        })
        .catch(() => fallbackCopy(textToCopy));
    } else {
      fallbackCopy(textToCopy);
    }
  };

  const fallbackCopy = (text: string) => {
    try {
      if (hiddenCopyRef.current) {
        hiddenCopyRef.current.value = text;
        hiddenCopyRef.current.select();
        const success = document.execCommand("copy");
        if (success) {
          setCopyToast(auth.techDetails.copied);
        } else {
          setCopyToast(auth.techDetails.copyFailed);
        }
      } else {
        setCopyToast(auth.techDetails.copyFailed);
      }
    } catch {
      setCopyToast(auth.techDetails.copyFailed);
    }
    setTimeout(() => setCopyToast(null), 2500);
  };

  const handleContinueAsGuest = () => {
    setGuestDismissed(true);
    const destination = sanitizeRedirectUrl(rawNextParam, "/");
    router.replace(destination);
  };

  const isValidOtp = otpCode.replace(/\D/g, "").length >= 6 && otpCode.replace(/\D/g, "").length <= 8;

  return (
    <div className="flex min-h-[80vh] w-full items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 md:p-8 shadow-2xl backdrop-blur-md">
        {/* Site URL Mismatch Banner */}
        {siteUrlMismatch && (
          <div className="mb-6 rounded-xl border border-gold/30 bg-gold/10 p-4 text-xs text-tx">
            <p className="font-semibold text-gold">{auth.siteUrlMismatchTitle}</p>
            <p className="mt-1 text-tx-muted">{auth.siteUrlMismatchBody}</p>
            <a
              href={mainSiteRedirectUrl}
              className="mt-2.5 inline-flex items-center gap-1.5 font-semibold text-violet-glow hover:underline cursor-pointer"
            >
              <span>{auth.siteUrlMismatchLink}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-violet/20 text-violet-glow border border-violet/30 font-serif text-2xl font-bold tracking-widest">
            A
          </div>
          <h1 className="font-serif text-2xl font-bold text-tx">{auth.loginTitle}</h1>
          <p className="mt-1 text-xs md:text-sm text-tx-muted">{auth.loginSubtitle}</p>
        </div>

        {/* Error Alert */}
        {errorKey && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs md:text-sm text-red-300">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
              <div>
                {auth.errors[errorKey as keyof typeof auth.errors] || auth.errors.genericError}
              </div>
            </div>

            {/* Collapsible Technical Details */}
            {errorDetails && (
              <details className="mt-3 border-t border-red-500/20 pt-2.5 group">
                <summary className="flex items-center justify-between cursor-pointer font-medium text-xs text-red-300/80 hover:text-red-200 select-none">
                  <span>{auth.techDetails.toggle}</span>
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 space-y-1.5 text-[11px] font-mono text-tx-muted bg-ink/50 p-2.5 rounded-lg border border-line/50">
                  <div>
                    <span className="text-tx-muted">{auth.techDetails.time}</span> {errorDetails.timestamp}
                  </div>
                  <div>
                    <span className="text-tx-muted">{auth.techDetails.code}</span> {errorDetails.status}
                  </div>
                  <div>
                    <span className="text-tx-muted">{auth.techDetails.errorName}</span> {errorDetails.errorName}
                  </div>
                  <div className="break-all">
                    <span className="text-tx-muted">{auth.techDetails.message}</span> {errorDetails.sanitizedMessage}
                  </div>
                  {errorDetails.urlTruncatedStatus && (
                    <div className="text-gold">
                      <span>{auth.techDetails.urlTruncated}</span> {errorDetails.urlTruncatedStatus}
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleCopyTechDetails}
                      aria-label={auth.techDetails.copy}
                      className="inline-flex items-center gap-1 rounded border border-line bg-card px-2 py-1 text-[10px] text-tx-muted hover:text-tx hover:border-violet-glow transition cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      <span>{auth.techDetails.copy}</span>
                    </button>
                    {copyToast && <span className="text-gold font-sans text-[10px]">{copyToast}</span>}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Hidden textarea for copy fallback */}
        <textarea ref={hiddenCopyRef} aria-hidden="true" className="sr-only" tabIndex={-1} readOnly defaultValue="" />

        {/* Form Steps */}
        {step === "email" ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label htmlFor="email-input" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-tx-muted">
                {auth.emailLabel}
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tx-muted" />
                <input
                  id="email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={auth.emailPlaceholder}
                  disabled={loading}
                  required
                  className="w-full rounded-xl border border-line bg-ink/60 py-2.5 pl-10 pr-4 text-sm text-tx placeholder-tx-muted focus:border-violet-glow focus:outline-none focus:ring-1 focus:ring-violet-glow disabled:opacity-50"
                />
              </div>
            </div>

            {/* Consent Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-tx-muted">
                <input
                  type="checkbox"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line bg-ink/60 text-violet focus:ring-violet-glow cursor-pointer"
                />
                <span>
                  {auth.consentCheckbox}{" "}
                  <Link href="/legal/terms" target="_blank" className="text-violet-glow underline hover:text-white">
                    {auth.termsLink}
                  </Link>{" "}
                  {auth.and}{" "}
                  <Link href="/legal/privacy" target="_blank" className="text-violet-glow underline hover:text-white">
                    {auth.privacyLink}
                  </Link>
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !consentAccepted}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 text-sm font-semibold text-white shadow-lg shadow-violet/30 transition hover:bg-violet-glow disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>{auth.getCodeBtn}</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="text-center">
              <p className="text-xs text-tx-muted">
                {auth.enterOtpSubtitle.replace("{email}", email)}
              </p>
            </div>

            <div>
              <label htmlFor="otp-input" className="mb-1.5 block text-center text-xs font-semibold uppercase tracking-wider text-tx-muted">
                {auth.enterOtpTitle}
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tx-muted" />
                <input
                  id="otp-input"
                  type="text"
                  maxLength={8}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={auth.otpPlaceholder}
                  disabled={loading}
                  autoFocus
                  required
                  className="w-full rounded-xl border border-line bg-ink/60 py-2.5 pl-10 pr-4 text-center font-mono text-lg tracking-widest text-gold placeholder-tx-muted focus:border-violet-glow focus:outline-none focus:ring-1 focus:ring-violet-glow disabled:opacity-50"
                />
              </div>
              <p className="mt-2 text-center text-[11px] text-tx-muted leading-tight">
                {auth.otpSubtext}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !isValidOtp}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 text-sm font-semibold text-white shadow-lg shadow-violet/30 transition hover:bg-violet-glow disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>{auth.verifyCodeBtn}</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setErrorKey(null);
                  setErrorDetails(null);
                }}
                className="text-tx-muted hover:text-tx cursor-pointer"
              >
                ← {auth.changeEmailBtn}
              </button>

              {resendTimer > 0 ? (
                <span className="text-tx-muted">
                  {auth.resendCodeTimer.replace("{seconds}", String(resendTimer))}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={loading}
                  className="text-violet-glow hover:underline cursor-pointer"
                >
                  {auth.resendCodeBtn}
                </button>
              )}
            </div>
          </form>
        )}

        {/* Continue as guest button */}
        <div className="mt-6 border-t border-line/60 pt-4 text-center">
          <button
            type="button"
            onClick={handleContinueAsGuest}
            className="text-xs text-tx-muted hover:text-tx transition underline decoration-line hover:decoration-tx cursor-pointer"
          >
            {auth.continueAsGuest}
          </button>
        </div>
      </div>
    </div>
  );
}
