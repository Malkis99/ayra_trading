"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { useGame } from "@/lib/game-context";
import { resolvePostLoginRoute, readAccountGameState, safeNextAfterLogin } from "@/lib/auth/routing";
import { isValidLatinNickname } from "@/lib/stats";
import { UniverseCard, UniverseLoader, UniverseScreen } from "@/components/universe/UniverseBackdrop";
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
  const [noRowAfterOnboarding, setNoRowAfterOnboarding] = useState(false);

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
    if (decidedRef.current || noRowAfterOnboarding) return;
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

    const accountState = readAccountGameState(user.id);
    // No profile row is normal for a new account (-> /awakening). After onboarding it means the server
    // never created the row, and saving the nickname cannot work: say so instead of looping.
    if (profileStatus === "missing" && accountState?.onboarding?.status === "done") {
      setNoRowAfterOnboarding(true);
      return;
    }

    decidedRef.current = true;

    resolvePostLoginRoute({
      user,
      profile: profileStatus === "loaded" ? profile : null,
      rawNextParam: rawNext,
      guestState: accountState,
      checkNicknameAvailable,
      saveNickname,
    }).then((res) => {
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
    noRowAfterOnboarding,
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

  if (profileFailed || noRowAfterOnboarding) {
    return (
      <UniverseScreen>
        <UniverseCard className="space-y-4 text-center">
        <div role="alert" className="space-y-4">
          <AlertCircle className="mx-auto h-8 w-8 text-vi" aria-hidden="true" />
          <h1 className="font-serif text-lg font-bold text-tx">
            {profileFailed ? dict.auth.continueProfileErrorTitle : dict.auth.continueNoRowTitle}
          </h1>
          <p className="text-sm text-mu">
            {profileFailed ? dict.auth.continueProfileErrorText : dict.auth.continueNoRowText}
          </p>
          <button
            type="button"
            onClick={() => {
              setRetries(0);
              setNoRowAfterOnboarding(false);
              refreshProfile();
            }}
            className="btn min-h-[44px] w-full justify-center"
          >
            {dict.auth.continueRetryBtn}
          </button>
        </div>
        </UniverseCard>
      </UniverseScreen>
    );
  }

  return <ContinueLoader label={dict.auth.continueLoading} />;
}

function ContinueLoader({ label }: { label?: string }) {
  return <UniverseLoader label={label} />;
}

export default function AuthContinuePage() {
  return (
    <Suspense fallback={<ContinueLoader />}>
      <ContinueRouter />
    </Suspense>
  );
}
