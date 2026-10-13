"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { useGame } from "@/lib/game-context";
import { resolvePostLoginRoute, readAccountGameState, safeNextAfterLogin } from "@/lib/auth/routing";
import { isValidLatinNickname } from "@/lib/stats";
import { authDebug, describeGameState } from "@/lib/auth/debug";
import { AppStorage } from "@/lib/storage";
import { NicknameConflictModal } from "@/components/NicknameConflictModal";

const PROFILE_RETRY_DELAYS_MS = [400, 800, 1600];

/**
 * Post-login router: the single place that decides where to go after signing in.
 * Waits for an authenticated session, the account's own storage space and its cloud profile,
 * then calls resolvePostLoginRoute exactly once.
 */
function ContinueRouter() {
  const router = useRouter();
  const rawNext = useSearchParams().get("next");
  const { dict } = useApp();
  const { isLoaded } = useGame();
  const {
    authState,
    user,
    profile,
    profileStatus,
    activeSpaceId,
    isSpaceReady,
    refreshProfile,
    checkNicknameAvailable,
    saveNickname,
    reportRouteReason,
  } = useAuth();

  const decidedRef = useRef(false);
  const [retries, setRetries] = useState(0);
  const [conflictNickname, setConflictNickname] = useState<string | null>(null);

  const accountSpaceReady = Boolean(user) && isSpaceReady && activeSpaceId === `account:${user?.id}` && isLoaded;
  const profileFailed = profileStatus === "error" && retries >= PROFILE_RETRY_DELAYS_MS.length;

  // Transient profile read failures: retry a few times before asking the user.
  useEffect(() => {
    if (authState !== "authenticated" || profileStatus !== "error" || retries >= PROFILE_RETRY_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      setRetries((r) => r + 1);
      refreshProfile();
    }, PROFILE_RETRY_DELAYS_MS[retries]);
    return () => clearTimeout(timer);
  }, [authState, profileStatus, retries, refreshProfile]);

  useEffect(() => {
    if (decidedRef.current) return;
    if (authState === "guest") {
      decidedRef.current = true;
      router.replace("/login");
      return;
    }
    if (authState !== "authenticated" || !user || !accountSpaceReady) return;
    if (profileStatus === "idle") {
      refreshProfile();
      return;
    }
    if (profileStatus !== "loaded" && profileStatus !== "missing") return;

    decidedRef.current = true;
    const accountState = readAccountGameState(user.id);
    authDebug("continue.decide", {
      activeSpace: AppStorage.getActiveSpaceId(),
      profileStatus,
      profileHasNickname: Boolean(profile?.nickname),
      accountState: describeGameState(accountState ? JSON.stringify(accountState) : null),
    });

    resolvePostLoginRoute({
      user,
      profile: profileStatus === "loaded" ? profile : null,
      rawNextParam: rawNext,
      guestState: accountState,
      checkNicknameAvailable,
      saveNickname,
    }).then((res) => {
      authDebug("resolvePostLoginRoute", { destination: res.destination, source: res.source, navigated: true });
      reportRouteReason(res.source);
      if (res.nicknameConflict && res.candidateNickname && isValidLatinNickname(res.candidateNickname)) {
        setConflictNickname(res.candidateNickname);
        return;
      }
      router.replace(res.destination);
    });
  }, [
    authState,
    user,
    profile,
    profileStatus,
    accountSpaceReady,
    rawNext,
    router,
    refreshProfile,
    checkNicknameAvailable,
    saveNickname,
    reportRouteReason,
  ]);

  if (conflictNickname) {
    return (
      <NicknameConflictModal
        initialNickname={conflictNickname}
        onResolved={() => router.replace(safeNextAfterLogin(rawNext))}
      />
    );
  }

  if (profileFailed) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-ink px-4">
        <div role="alert" className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-s1 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-vi" aria-hidden="true" />
          <h1 className="font-serif text-lg font-bold text-tx">{dict.auth.continueProfileErrorTitle}</h1>
          <p className="text-sm text-mu">{dict.auth.continueProfileErrorText}</p>
          <button
            type="button"
            onClick={() => {
              setRetries(0);
              refreshProfile();
            }}
            className="btn min-h-[44px] w-full justify-center"
          >
            {dict.auth.continueRetryBtn}
          </button>
        </div>
      </div>
    );
  }

  return <ContinueLoader label={dict.auth.continueLoading} />;
}

function ContinueLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-ink" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-vi/30 border-t-vi motion-reduce:animate-none" aria-hidden="true" />
      {label && <span className="text-sm text-mu">{label}</span>}
    </div>
  );
}

export default function AuthContinuePage() {
  return (
    <Suspense fallback={<ContinueLoader />}>
      <ContinueRouter />
    </Suspense>
  );
}
