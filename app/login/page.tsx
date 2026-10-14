"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { postLoginRouterUrl } from "@/lib/auth/routing";
import { authTabChannel } from "@/lib/auth/tab-channel";
import { sanitizeRedirectUrl, buildSafeSiteUrlRedirect } from "@/lib/auth/redirect-whitelist";
import { type SanitizedErrorInfo } from "@/lib/auth/error-sanitizer";
import { AppStorage } from "@/lib/storage";
import { Mail, MailCheck, KeyRound, ArrowRight, ArrowLeft, Check, AlertCircle, RefreshCw, Copy, ExternalLink, ChevronDown, Sparkles, Loader2 } from "lucide-react";
import { formatString } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/forms";
import { UniverseCard, UniverseScreen } from "@/components/universe/UniverseBackdrop";

export default function LoginPage() {
  const { dict, lang, setLanguage } = useApp();
  const { auth } = dict;
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNextParam = searchParams.get("next");

  const { user, signInWithOtp, verifyOtp, isLoading: authLoading, setGuestDismissed } = useAuth();

  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<SanitizedErrorInfo | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

  // Multi-tab coordination state
  const [otherTabSignedIn, setOtherTabSignedIn] = useState(false);
  const submittedThisTabRef = useRef(false);
  const routingExecutedRef = useRef(false);
  const continueBtnRef = useRef<HTMLButtonElement | null>(null);
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

  // Subscribe to cross-tab auth messages
  useEffect(() => {
    const unsubscribe = authTabChannel.subscribe((msg) => {
      if (msg.type === "AUTH_SIGNED_IN" || msg.type === "AUTH_CLAIMED") {
        setOtherTabSignedIn(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Where to go after sign-in is decided only by the post-login router (/auth/continue).
  const executeRouting = () => {
    if (routingExecutedRef.current) return;
    routingExecutedRef.current = true;
    router.replace(postLoginRouterUrl(rawNextParam));
  };

  // Handle post-login route resolution when user becomes active
  useEffect(() => {
    if (!authLoading && user) {
      if (submittedThisTabRef.current) {
        authTabChannel.broadcast("AUTH_SIGNED_IN", { userId: user.id });
        executeRouting();
      } else {
        setOtherTabSignedIn(true);
      }
    }
  }, [user, authLoading]);

  // Auto-focus on "Continue here" button when multi-tab card is shown
  useEffect(() => {
    if (otherTabSignedIn && user) {
      continueBtnRef.current?.focus();
    }
  }, [otherTabSignedIn, user]);

  const handleContinueHere = async () => {
    routingExecutedRef.current = false;
    authTabChannel.broadcast("AUTH_CLAIMED", { userId: user?.id });
    executeRouting();
  };

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

    submittedThisTabRef.current = true;
    setLoading(true);
    const res = await verifyOtp(email.trim(), cleanCode, consentAccepted);
    setLoading(false);

    if (res.success) {
      authTabChannel.broadcast("AUTH_SIGNED_IN");
      // executeRouting handled in useEffect when user state is updated
    } else {
      submittedThisTabRef.current = false;
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

  const primaryBtn =
    "relative flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pri via-[#6b4bb4] to-pri text-[15px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(163,138,209,0.8)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

  const langSwitch = (
    <div className="fixed right-4 top-4 z-20 flex items-center rounded-lg border border-line bg-s2/60 p-0.5 backdrop-blur" role="group" aria-label={dict.settings.languageLabel}>
      {(["ru", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLanguage(l)}
          className={`h-8 min-w-[36px] rounded-md px-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
            lang === l ? "bg-pri text-white" : "text-mu hover:text-tx"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );

  const logo = (
    <div className="mb-6 text-center">
      <div className="font-serif text-3xl font-bold tracking-[0.32em] text-tx">AYRA</div>
      <div aria-hidden="true" className="mx-auto mt-3 h-px w-16 bg-gradient-to-r from-transparent via-vi to-transparent" />
    </div>
  );

  // Render Multi-tab Coordination Card if sign-in happened in another tab
  if (user && otherTabSignedIn && !submittedThisTabRef.current) {
    return (
      <UniverseScreen>
        {langSwitch}
        <UniverseCard className="space-y-5 text-center">
          <div aria-live="polite" className="space-y-5">
            {logo}
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-vi/40 bg-vi/15 text-vi">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="font-serif text-2xl font-bold text-tx">{auth.multiTabNoticeTitle}</h1>
              <p className="text-sm text-mu">{auth.multiTabNoticeSubtitle}</p>
            </div>
            <button ref={continueBtnRef} type="button" onClick={handleContinueHere} className={primaryBtn}>
              {auth.continueHereBtn}
            </button>
          </div>
        </UniverseCard>
      </UniverseScreen>
    );
  }

  return (
    <UniverseScreen>
      {langSwitch}
      <UniverseCard>
        {logo}

        {/* Site URL Mismatch Banner */}
        {siteUrlMismatch && (
          <div className="mb-5 rounded-xl border border-vi/40 bg-vi/10 p-4 text-xs text-tx">
            <p className="font-semibold">{auth.siteUrlMismatchTitle}</p>
            <p className="mt-1 text-mu">{auth.siteUrlMismatchBody}</p>
            <a href={mainSiteRedirectUrl} className="mt-2.5 inline-flex items-center gap-1.5 font-semibold text-vi hover:underline">
              <span>{auth.siteUrlMismatchLink}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        )}

        {/* Title */}
        <div className="mb-6 text-center">
          {step === "email" ? (
            <>
              <h1 className="font-serif text-[26px] font-bold leading-tight text-tx sm:text-[28px]">{auth.loginTitle}</h1>
              <p className="mt-2 text-sm text-mu">{auth.loginSubtitle}</p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-vi/40 bg-vi/15 text-vi motion-safe:animate-[ayraPop_300ms_ease-out]">
                <MailCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="font-serif text-[26px] font-bold leading-tight text-tx">{auth.checkMailTitle}</h1>
              <p className="mt-2 break-words text-sm text-mu">{formatString(auth.enterOtpSubtitle, { email })}</p>
            </>
          )}
        </div>

        {/* Error Alert */}
        {errorKey && (
          <div role="alert" className="mb-5 rounded-xl border border-short/40 bg-short/10 p-3.5 text-sm text-tx motion-safe:animate-[ayraFade_200ms_ease-out]">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-short" aria-hidden="true" />
              <div>{auth.errors[errorKey as keyof typeof auth.errors] || auth.errors.genericError}</div>
            </div>

            {/* Collapsible Technical Details */}
            {errorDetails && (
              <details className="group mt-3 border-t border-short/20 pt-2.5">
                <summary className="flex cursor-pointer select-none items-center justify-between text-xs font-medium text-mu hover:text-tx">
                  <span>{auth.techDetails.toggle}</span>
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-2 space-y-1.5 rounded-lg border border-line/50 bg-ink/50 p-2.5 font-mono text-[11px] text-mu">
                  <div>
                    {auth.techDetails.time} {errorDetails.timestamp}
                  </div>
                  <div>
                    {auth.techDetails.code} {errorDetails.status}
                  </div>
                  <div>
                    {auth.techDetails.errorName} {errorDetails.errorName}
                  </div>
                  <div className="break-all">
                    {auth.techDetails.message} {errorDetails.sanitizedMessage}
                  </div>
                  {errorDetails.urlTruncatedStatus && (
                    <div>
                      {auth.techDetails.urlTruncated} {errorDetails.urlTruncatedStatus}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleCopyTechDetails}
                      className="inline-flex items-center gap-1 rounded border border-line bg-s1 px-2 py-1 text-[10px] text-mu transition hover:border-vi hover:text-tx"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      <span>{auth.techDetails.copy}</span>
                    </button>
                    {copyToast && <span className="font-sans text-[10px] text-vi">{copyToast}</span>}
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
          <form onSubmit={handleSendCode} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email-input" className="sr-only">
                {auth.emailLabel}
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mu" aria-hidden="true" />
                <input
                  id="email-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={auth.emailPlaceholder}
                  disabled={loading}
                  required
                  aria-invalid={errorKey === "invalidEmail" || undefined}
                  className="h-14 w-full rounded-xl border border-edge bg-field/80 pl-12 pr-4 text-base text-tx placeholder:text-mu/60 transition-colors focus:border-vi focus:outline-none focus:ring-2 focus:ring-vi/50 disabled:opacity-50"
                />
              </div>
            </div>

            <Checkbox
              checked={consentAccepted}
              onChange={setConsentAccepted}
              className="text-left"
              label={
                <span className="text-xs text-mu">
                  {auth.consentCheckbox}{" "}
                  <Link href="/legal/terms" target="_blank" className="text-vi underline hover:text-tx">
                    {auth.termsLink}
                  </Link>{" "}
                  {auth.and}{" "}
                  <Link href="/legal/privacy" target="_blank" className="text-vi underline hover:text-tx">
                    {auth.privacyLink}
                  </Link>
                </span>
              }
            />

            <button type="submit" disabled={loading || !consentAccepted} aria-busy={loading} className={primaryBtn}>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  <span>{auth.getCodeBtn}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>

            <p className="text-center text-[11px] leading-snug text-mu/80">{auth.ageNote}</p>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label htmlFor="otp-input" className="mb-2 block text-center text-xs font-semibold uppercase tracking-wider text-mu">
                {auth.enterOtpTitle}
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mu" aria-hidden="true" />
                <input
                  id="otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={auth.otpPlaceholder}
                  disabled={loading}
                  autoFocus
                  required
                  className="h-14 w-full rounded-xl border border-edge bg-field/80 pl-12 pr-4 text-center font-mono text-xl tracking-[0.4em] text-tx placeholder:text-mu/40 focus:border-vi focus:outline-none focus:ring-2 focus:ring-vi/50 disabled:opacity-50"
                />
              </div>
              <p className="mt-2 text-center text-[11px] leading-snug text-mu">{auth.checkMailHint}</p>
            </div>

            <button type="submit" disabled={loading || !isValidOtp} aria-busy={loading} className={primaryBtn}>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>{auth.verifyCodeBtn}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleResendCode}
              disabled={loading || resendTimer > 0}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-edge text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:text-mu disabled:hover:border-edge"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">
                {resendTimer > 0 ? formatString(auth.resendIn, { seconds: resendTimer }) : auth.resendNow}
              </span>
            </button>

            <p className="text-center text-[11px] leading-snug text-mu">{auth.otpSubtext}</p>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setErrorKey(null);
                  setErrorDetails(null);
                }}
                className="inline-flex items-center gap-1 text-xs text-mu hover:text-tx"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {auth.changeEmailBtn}
              </button>
            </div>
          </form>
        )}

        {/* Continue as guest */}
        <div className="mt-6 border-t border-line/60 pt-4 text-center">
          <button type="button" onClick={handleContinueAsGuest} className="text-xs text-mu underline decoration-line transition hover:text-tx hover:decoration-tx">
            {auth.continueAsGuest}
          </button>
        </div>
      </UniverseCard>
    </UniverseScreen>
  );
}
