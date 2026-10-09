"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect-whitelist";
import { Mail, KeyRound, ArrowRight, Check, AlertCircle, RefreshCw } from "lucide-react";

export default function LoginPage() {
  const { dict } = useApp();
  const { auth } = dict;
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNextParam = searchParams.get("next");

  const { user, profile, signInWithOtp, verifyOtp, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

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
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorKey(null);

    if (!otpCode || otpCode.trim().length !== 6) {
      setErrorKey("invalidCode");
      return;
    }

    setLoading(true);
    const res = await verifyOtp(email.trim(), otpCode.trim(), consentAccepted);
    setLoading(false);

    if (res.success) {
      // Redirect handled by useEffect when user state updates
    } else {
      setErrorKey(res.errorKey || "invalidCode");
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0 || loading) return;
    setErrorKey(null);
    setLoading(true);
    const res = await signInWithOtp(email.trim());
    setLoading(false);

    if (res.success) {
      setResendTimer(60);
    } else {
      setErrorKey(res.errorKey || "genericError");
    }
  };

  return (
    <div className="flex min-h-[80vh] w-full items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 md:p-8 shadow-2xl backdrop-blur-md">
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
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs md:text-sm text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
            <div>
              {auth.errors[errorKey as keyof typeof auth.errors] || auth.errors.genericError}
            </div>
          </div>
        )}

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
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={auth.otpPlaceholder}
                  disabled={loading}
                  autoFocus
                  required
                  className="w-full rounded-xl border border-line bg-ink/60 py-2.5 pl-10 pr-4 text-center font-mono text-lg tracking-widest text-gold placeholder-tx-muted focus:border-violet-glow focus:outline-none focus:ring-1 focus:ring-violet-glow disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.trim().length !== 6}
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
      </div>
    </div>
  );
}
