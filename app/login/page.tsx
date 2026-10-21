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
import { SIGN_IN_LOCK_SECONDS, SIGN_IN_MAX_FAILS } from "@/lib/auth/password";
import { authEmailFlowsOpen } from "@/lib/auth/email-sending";
import { Mail, MailCheck, KeyRound, Lock, ArrowRight, ArrowLeft, Check, AlertCircle, RefreshCw, Copy, ExternalLink, ChevronDown, Sparkles, Loader2, Eye, EyeOff } from "lucide-react";
import { formatString } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/forms";
import { UniverseCard, UniverseScreen } from "@/components/universe/UniverseBackdrop";

/** signIn = e-mail + password (no letter); signUp = e-mail + password + consent, then the code; forgot = code + new password. */
type Mode = "signIn" | "signUp" | "forgot";
/** form = the first screen of the mode; code = sign-up confirmation code; reset = «forgot» code + new password. */
type Step = "form" | "code" | "reset";

const fieldClass =
  "h-14 w-full rounded-xl border border-edge bg-field/80 pl-12 text-base text-tx placeholder:text-mu/60 transition-colors focus:border-vi focus:outline-none focus:ring-2 focus:ring-vi/50 disabled:opacity-50";

function PasswordField({
  id,
  value,
  onChange,
  label,
  autoComplete,
  disabled,
  showLabel,
  hideLabel,
  hint,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete: "current-password" | "new-password";
  disabled: boolean;
  showLabel: string;
  hideLabel: string;
  hint?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mu" aria-hidden="true" />
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`${fieldClass} pr-14`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        >
          {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[11px] leading-snug text-mu">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  const { dict, lang, setLanguage } = useApp();
  const { auth } = dict;
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNextParam = searchParams.get("next");

  const {
    user,
    signInWithPassword,
    signUpWithPassword,
    resendSignupCode,
    requestPasswordReset,
    completePasswordReset,
    verifyOtp,
    isLoading: authLoading,
    setGuestDismissed,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("signIn");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<SanitizedErrorInfo | null>(null);

  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

  // Sign-in screen lock after repeated wrong passwords (the server has its own limits)
  const [failedSignIns, setFailedSignIns] = useState(0);
  const [lockLeft, setLockLeft] = useState(0);

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

  // Sign-in lock countdown
  useEffect(() => {
    if (lockLeft <= 0) return;
    const interval = setInterval(() => setLockLeft((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [lockLeft]);

  const clearError = () => {
    setErrorKey(null);
    setErrorDetails(null);
  };

  const showError = (key: string | undefined, details?: SanitizedErrorInfo) => {
    setErrorKey(key || "genericError");
    setErrorDetails(details ?? null);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setStep("form");
    setOtpCode("");
    setNewPassword("");
    clearError();
  };

  /** Runs an action that may sign in: this tab routes after it (multi-tab rule). */
  const runSignIn = async (action: () => Promise<{ success: boolean; errorKey?: string; errorDetails?: SanitizedErrorInfo }>) => {
    submittedThisTabRef.current = true;
    setLoading(true);
    const res = await action();
    setLoading(false);
    if (res.success) {
      authTabChannel.broadcast("AUTH_SIGNED_IN");
      // routing is done by the effect above once the user state is updated
    } else {
      submittedThisTabRef.current = false;
    }
    return res;
  };

  const handleSignIn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading || lockLeft > 0) return;
    clearError();
    const res = await runSignIn(() => signInWithPassword(email.trim(), password));
    if (res.success) {
      setFailedSignIns(0);
      return;
    }
    if (res.errorKey === "invalidCredentials") {
      const fails = failedSignIns + 1;
      if (fails >= SIGN_IN_MAX_FAILS) {
        setFailedSignIns(0);
        setLockLeft(SIGN_IN_LOCK_SECONDS);
      } else {
        setFailedSignIns(fails);
      }
    }
    showError(res.errorKey, res.errorDetails);
  };

  const handleSignUp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    clearError();
    submittedThisTabRef.current = true; // «Confirm email» off: Supabase signs in right away
    setLoading(true);
    const res = await signUpWithPassword(email.trim(), password, consentAccepted);
    setLoading(false);
    if (!res.success) {
      submittedThisTabRef.current = false;
      showError(res.errorKey, res.errorDetails);
      return;
    }
    if (res.signedIn) {
      authTabChannel.broadcast("AUTH_SIGNED_IN");
      return;
    }
    submittedThisTabRef.current = false;
    setOtpCode("");
    setStep("code");
    setResendTimer(60);
  };

  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    clearError();
    const cleanCode = otpCode.replace(/\D/g, "");
    if (cleanCode.length < 6 || cleanCode.length > 8) {
      setErrorKey("invalidOrExpiredCode");
      return;
    }
    // consent was given when the account was created
    const res = await runSignIn(() => verifyOtp(email.trim(), cleanCode, true));
    if (!res.success) showError(res.errorKey || "invalidOrExpiredCode", res.errorDetails);
  };

  /** «Email not confirmed» on sign-in: send the sign-up code again and go to the code screen. */
  const handleConfirmAgain = async () => {
    if (loading) return;
    clearError();
    setLoading(true);
    const res = await resendSignupCode(email.trim());
    setLoading(false);
    if (!res.success) {
      showError(res.errorKey, res.errorDetails);
      return;
    }
    setMode("signUp");
    setOtpCode("");
    setStep("code");
    setResendTimer(60);
  };

  const handleForgot = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    clearError();
    setLoading(true);
    const res = await requestPasswordReset(email.trim());
    setLoading(false);
    if (!res.success) {
      showError(res.errorKey, res.errorDetails);
      return;
    }
    setOtpCode("");
    setNewPassword("");
    setStep("reset");
    setResendTimer(60);
  };

  const handleReset = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    clearError();
    const res = await runSignIn(() => completePasswordReset(email.trim(), otpCode, newPassword));
    if (!res.success) showError(res.errorKey, res.errorDetails);
  };

  const handleResendCode = async () => {
    if (resendTimer > 0 || loading) return;
    clearError();
    setLoading(true);
    const res = step === "reset" ? await requestPasswordReset(email.trim()) : await resendSignupCode(email.trim());
    setLoading(false);
    if (res.success) {
      setResendTimer(60);
    } else {
      showError(res.errorKey, res.errorDetails);
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

  // Without custom SMTP: no registration and no «Forgot password» (they need letters); sign-in by password works
  const emailOpen = authEmailFlowsOpen();

  const cleanOtp = otpCode.replace(/\D/g, "");
  const isValidOtp = cleanOtp.length >= 6 && cleanOtp.length <= 8;

  const primaryBtn =
    "relative flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pri via-[#6b4bb4] to-pri text-[15px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(163,138,209,0.8)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";
  const secondaryBtn =
    "flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-edge text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:text-mu disabled:hover:border-edge";
  const linkBtn = "inline-flex items-center gap-1 text-xs text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi rounded";

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

  const title =
    step === "code"
      ? auth.checkMailTitle
      : step === "reset"
      ? auth.resetTitle
      : mode === "forgot"
      ? auth.forgotTitle
      : mode === "signUp"
      ? auth.signUpTitle
      : auth.loginTitle;
  const subtitle =
    mode === "signUp" && step === "form" && !emailOpen
      ? ""
      : step === "code"
      ? formatString(auth.signUpCodeSubtitle, { email })
      : step === "reset"
      ? formatString(auth.resetSentSubtitle, { email })
      : mode === "forgot"
      ? auth.forgotSubtitle
      : mode === "signUp"
      ? auth.signUpSubtitle
      : auth.loginSubtitle;

  const emailField = (
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
          autoComplete={mode === "signUp" ? "email" : "username"}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={auth.emailPlaceholder}
          disabled={loading}
          required
          aria-invalid={errorKey === "invalidEmail" || undefined}
          className={`${fieldClass} pr-4`}
        />
      </div>
    </div>
  );

  const codeField = (labelText: string) => (
    <div>
      <label htmlFor="otp-input" className="mb-2 block text-center text-xs font-semibold uppercase tracking-wider text-mu">
        {labelText}
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
  );

  const resendButton = (
    <button type="button" onClick={handleResendCode} disabled={loading || resendTimer > 0} className={secondaryBtn}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      <span className="tabular-nums">{resendTimer > 0 ? formatString(auth.resendIn, { seconds: resendTimer }) : auth.resendNow}</span>
    </button>
  );

  const submitContent = (label: string, icon: React.ReactNode) =>
    loading ? (
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
    ) : (
      <>
        {icon}
        <span>{label}</span>
      </>
    );

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

        {/* Sign in / Sign up tabs */}
        {step === "form" && mode !== "forgot" && (
          <div role="tablist" aria-label={auth.tabsLabel} className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-s2/60 p-1">
            {(["signIn", "signUp"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                id={`auth-tab-${m}`}
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`h-10 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
                  mode === m ? "bg-pri text-white" : "text-mu hover:text-tx"
                }`}
              >
                {m === "signIn" ? auth.tabSignIn : auth.tabSignUp}
              </button>
            ))}
          </div>
        )}

        {/* Title */}
        <div className="mb-6 text-center">
          {step !== "form" && (
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-vi/40 bg-vi/15 text-vi motion-safe:animate-[ayraPop_300ms_ease-out]">
              <MailCheck className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
          <h1 className="font-serif text-[22px] font-bold leading-tight text-tx sm:text-[28px]">{title}</h1>
          {subtitle && (
            <p data-testid="login-subtitle" className="mt-2 break-words text-sm text-mu">
              {subtitle}
            </p>
          )}
        </div>

        {/* Error Alert */}
        {errorKey && (
          <div role="alert" data-testid="login-error" className="mb-5 rounded-xl border border-short/40 bg-short/10 p-3.5 text-sm text-tx motion-safe:animate-[ayraFade_200ms_ease-out]">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-short" aria-hidden="true" />
              <div className="space-y-2">
                <div>
                  {errorKey === "emailNotConfirmed" && !emailOpen
                    ? auth.emailNotConfirmedClosed
                    : errorKey === "resendTooSoon"
                    ? formatString(auth.errors.resendTooSoon, { seconds: errorDetails?.retryAfterSeconds ?? 60 })
                    : auth.errors[errorKey as keyof typeof auth.errors] || auth.errors.genericError}
                </div>
                {errorKey === "emailNotConfirmed" && emailOpen && (
                  <button type="button" onClick={handleConfirmAgain} disabled={loading} className="text-sm font-semibold text-vi underline hover:text-tx">
                    {auth.sendCodeAgainBtn}
                  </button>
                )}
              </div>
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

        {/* Sign in: e-mail + password, no letter */}
        {step === "form" && mode === "signIn" && (
          <form onSubmit={handleSignIn} className="space-y-4" noValidate role="tabpanel" aria-labelledby="auth-tab-signIn">
            {emailField}
            <PasswordField
              id="password-input"
              value={password}
              onChange={setPassword}
              label={auth.passwordLabel}
              autoComplete="current-password"
              disabled={loading}
              showLabel={auth.showPassword}
              hideLabel={auth.hidePassword}
              invalid={errorKey === "invalidCredentials" || errorKey === "passwordBlank"}
            />
            {emailOpen && (
              <div className="flex justify-end">
                <button type="button" onClick={() => switchMode("forgot")} className={linkBtn} data-testid="forgot-link">
                  {auth.forgotLink}
                </button>
              </div>
            )}
            <button type="submit" disabled={loading || lockLeft > 0} aria-busy={loading} className={primaryBtn}>
              {submitContent(auth.signInBtn, <ArrowRight className="h-4 w-4" aria-hidden="true" />)}
            </button>
            {lockLeft > 0 && (
              <p role="status" data-testid="login-locked" className="text-center text-xs text-mu tabular-nums">
                {formatString(auth.lockedFor, { seconds: lockLeft })}
              </p>
            )}
            <p data-testid="old-account-hint" className="rounded-xl border border-line/60 bg-s1/60 p-3 text-[11px] leading-snug text-mu">
              {emailOpen ? auth.oldAccountHint : auth.oldAccountHintClosed}
            </p>
          </form>
        )}

        {/* Sign up closed until custom SMTP (lib/auth/email-sending.ts) */}
        {step === "form" && mode === "signUp" && !emailOpen && (
          <div role="tabpanel" aria-labelledby="auth-tab-signUp" data-testid="signup-closed" className="space-y-2 rounded-xl border border-line/60 bg-s1/60 p-4 text-center">
            <p className="text-sm font-semibold text-tx">{auth.signUpClosedTitle}</p>
            <p className="text-xs leading-snug text-mu">{auth.signUpClosedBody}</p>
          </div>
        )}

        {/* Sign up: e-mail + password + consent, then the code */}
        {step === "form" && mode === "signUp" && emailOpen && (
          <form onSubmit={handleSignUp} className="space-y-4" noValidate role="tabpanel" aria-labelledby="auth-tab-signUp">
            {emailField}
            <PasswordField
              id="password-input"
              value={password}
              onChange={setPassword}
              label={auth.passwordLabel}
              autoComplete="new-password"
              disabled={loading}
              showLabel={auth.showPassword}
              hideLabel={auth.hidePassword}
              hint={auth.passwordHint}
              invalid={errorKey === "passwordBlank" || errorKey === "passwordTooShort" || errorKey === "passwordTooLong"}
            />
            <Checkbox
              checked={consentAccepted}
              onChange={setConsentAccepted}
              className="text-left"
              label={
                <span data-testid="login-consent" className="text-xs text-mu">
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
              {submitContent(auth.signUpBtn, <ArrowRight className="h-4 w-4" aria-hidden="true" />)}
            </button>
            <p data-testid="login-age-note" className="text-center text-[11px] leading-snug text-mu/80">
              {auth.ageNote}
            </p>
          </form>
        )}

        {/* Forgot password: e-mail -> code */}
        {step === "form" && mode === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4" noValidate>
            {emailField}
            <button type="submit" disabled={loading} aria-busy={loading} className={primaryBtn}>
              {submitContent(auth.sendResetBtn, <Mail className="h-4 w-4" aria-hidden="true" />)}
            </button>
            <div className="text-center">
              <button type="button" onClick={() => switchMode("signIn")} className={linkBtn}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {auth.backToSignIn}
              </button>
            </div>
          </form>
        )}

        {/* Sign-up confirmation code */}
        {step === "code" && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            {codeField(auth.enterOtpTitle)}
            <button type="submit" disabled={loading || !isValidOtp} aria-busy={loading} className={primaryBtn}>
              {submitContent(auth.confirmBtn, <Check className="h-4 w-4" aria-hidden="true" />)}
            </button>
            {resendButton}
            <p data-testid="existing-account-hint" className="text-center text-[11px] leading-snug text-mu">
              {auth.existingAccountHint}
            </p>
            <p className="text-center text-[11px] leading-snug text-mu">{auth.otpSubtext}</p>
            <div className="text-center">
              <button type="button" onClick={() => switchMode("signUp")} className={linkBtn}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {auth.changeEmailBtn}
              </button>
            </div>
          </form>
        )}

        {/* Forgot password: code + new password */}
        {step === "reset" && (
          <form onSubmit={handleReset} className="space-y-4" noValidate>
            {codeField(auth.resetCodeLabel)}
            <PasswordField
              id="new-password-input"
              value={newPassword}
              onChange={setNewPassword}
              label={auth.newPasswordLabel}
              autoComplete="new-password"
              disabled={loading}
              showLabel={auth.showPassword}
              hideLabel={auth.hidePassword}
              hint={auth.passwordHint}
              invalid={errorKey === "passwordBlank" || errorKey === "passwordTooShort" || errorKey === "passwordTooLong"}
            />
            <button type="submit" disabled={loading || !isValidOtp} aria-busy={loading} className={primaryBtn}>
              {submitContent(auth.saveNewPasswordBtn, <Check className="h-4 w-4" aria-hidden="true" />)}
            </button>
            <p className="text-center text-[11px] leading-snug text-mu">{auth.resetOthersNote}</p>
            {resendButton}
            <div className="text-center">
              <button type="button" onClick={() => switchMode("signIn")} className={linkBtn}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {auth.backToSignIn}
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
