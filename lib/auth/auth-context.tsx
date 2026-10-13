"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isE2EMockEnabled, getSupabaseEnv } from "@/lib/supabase/config";
import { mapSupabaseError, type SanitizedErrorInfo } from "./error-sanitizer";
import { authTabChannel } from "./tab-channel";
import { spaceTabChannel } from "./space-channel";
import { resolvePostLoginRoute, readAccountGameState } from "./routing";
import { AppStorage, GUEST_SPACE_ID } from "@/lib/storage";
import { shouldOfferProfileSelect } from "@/lib/storage/profile-transfer";
import {
  getMockState,
  setMockState,
  mockIsNicknameAvailable,
  mockSetNickname,
  type MockUser,
  type MockProfile,
} from "./mock-auth";

export type AuthState = "loading" | "guest" | "authenticated";

export interface UserProfile {
  id: string;
  nickname: string | null;
  locale: "ru" | "en";
  timezone: string;
  age_group: string | null;
  minor_mode: boolean;
  consent_at: string | null;
  consent_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  created_at?: string;
}

interface AuthContextType {
  authState: AuthState;
  loadingTimedOut: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  activeSpaceId: string;
  isLoading: boolean;
  isGuest: boolean;
  isConfigured: boolean;
  guestDismissed: boolean;
  setGuestDismissed: (val: boolean) => void;
  lateSignInNotice: boolean;
  dismissLateSignInNotice: () => void;
  explicitGuestChosen: boolean;
  chooseGuestExplicitly: () => void;
  lastRouteReason: string | null;
  signInWithOtp: (email: string) => Promise<{ success: boolean; errorKey?: string; errorDetails?: SanitizedErrorInfo }>;
  verifyOtp: (
    email: string,
    token: string,
    consentAccepted?: boolean
  ) => Promise<{ success: boolean; errorKey?: string; errorDetails?: SanitizedErrorInfo }>;
  signOut: () => Promise<void>;
  checkNicknameAvailable: (nickname: string) => Promise<boolean>;
  saveNickname: (nickname: string) => Promise<{ success: boolean; errorKey?: string }>;
  refreshProfile: () => Promise<void>;
  suggestAvailableNickname: (baseNick: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [guestDismissed, setGuestDismissedState] = useState(false);
  const [explicitGuestChosen, setExplicitGuestChosen] = useState(false);
  const [lateSignInNotice, setLateSignInNotice] = useState(false);
  const [lastRouteReason, setLastRouteReason] = useState<string | null>(null);

  const prevAuthStateRef = useRef<AuthState>("loading");
  const routingExecutedUserIdRef = useRef<string | null>(null);

  const envInfo = getSupabaseEnv();
  const mockMode = isE2EMockEnabled();

  const setGuestDismissed = (val: boolean) => {
    setGuestDismissedState(val);
    try {
      AppStorage.setItem("ayra_guest_dismissed", val ? "1" : "0");
    } catch {}
  };

  const dismissLateSignInNotice = () => {
    setLateSignInNotice(false);
  };

  const chooseGuestExplicitly = () => {
    setExplicitGuestChosen(true);
    setGuestDismissed(true);
    setAuthState("guest");
    setLoadingTimedOut(false);
  };

  // Derive ActiveSpace strictly from AuthState
  const activeSpaceId =
    authState === "authenticated" && user
      ? `account:${user.id}`
      : authState === "guest"
      ? GUEST_SPACE_ID
      : GUEST_SPACE_ID; // When loading, no storage writes occur

  const switchSpaceTo = useCallback(async (targetState: AuthState, targetUserId: string | null) => {
    const oldSpaceId = AppStorage.getActiveSpaceId();
    const newSpaceId = targetState === "authenticated" && targetUserId ? `account:${targetUserId}` : GUEST_SPACE_ID;

    if (oldSpaceId !== newSpaceId) {
      await AppStorage.flushSpace(oldSpaceId);
      AppStorage.setUserId(targetState === "authenticated" ? targetUserId : null);
      spaceTabChannel.notifyLocal(oldSpaceId, newSpaceId);
      spaceTabChannel.broadcastSpaceChange(oldSpaceId, newSpaceId);
    } else {
      AppStorage.setUserId(targetState === "authenticated" ? targetUserId : null);
    }
  }, []);

  useEffect(() => {
    if (authState !== "loading") {
      switchSpaceTo(authState, user ? user.id : null);
    }
  }, [authState, user, switchSpaceTo]);

  useEffect(() => {
    try {
      const d = AppStorage.getItem("ayra_guest_dismissed");
      if (d === "1") setGuestDismissedState(true);
    } catch {}
  }, []);

  const loadProfile = useCallback(
    async (userId: string) => {
      if (mockMode) {
        const { profile: mProfile } = getMockState();
        setProfile(mProfile);
        return mProfile;
      }

      const supabase = createSupabaseBrowserClient();
      if (!supabase) return null;

      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();

      if (!error && data) {
        const prof = data as UserProfile;
        setProfile(prof);
        return prof;
      }
      return null;
    },
    [mockMode]
  );

  // Unified session listener and AuthState manager
  useEffect(() => {
    let isMounted = true;

    // ~1.5s timeout guard: show "Checking login..." banner if still loading
    const timer = setTimeout(() => {
      if (isMounted && prevAuthStateRef.current === "loading") {
        setLoadingTimedOut(true);
      }
    }, 1500);

    const updateToAuthenticated = async (u: AuthUser, initialSessionOrChange = false) => {
      setUser(u);
      const loadedProfile = await loadProfile(u.id);

      if (!isMounted) return;

      const wasLoading = prevAuthStateRef.current === "loading";
      const wasGuest = prevAuthStateRef.current === "guest";

      setAuthState("authenticated");
      setLoadingTimedOut(false);

      if (wasGuest && explicitGuestChosen) {
        setLateSignInNotice(true);
      }

      // Execute single post-login route resolution on loading -> authenticated transition
      if ((wasLoading || routingExecutedUserIdRef.current !== u.id) && u.id !== routingExecutedUserIdRef.current) {
        routingExecutedUserIdRef.current = u.id;

        const res = await resolvePostLoginRoute({
          user: u,
          profile: loadedProfile,
          guestState: readAccountGameState(u.id),
          offerProfileSelect: shouldOfferProfileSelect(u.id, loadedProfile?.nickname),
          checkNicknameAvailable: mockMode
            ? async (nick) => mockIsNicknameAvailable(nick)
            : async (nick) => {
                const sb = createSupabaseBrowserClient();
                if (!sb) return true;
                const { data } = await sb.rpc("is_nickname_available", { nick });
                return Boolean(data);
              },
          saveNickname: async (nick) => {
            if (mockMode) {
              const ok = mockSetNickname(nick);
              return { success: ok };
            }
            const sb = createSupabaseBrowserClient();
            if (!sb) return { success: false };
            const { error } = await sb.from("profiles").update({ nickname: nick }).eq("id", u.id);
            return { success: !error };
          },
        });

        setLastRouteReason(res.source);
      }

      prevAuthStateRef.current = "authenticated";
    };

    const updateToGuest = () => {
      setUser(null);
      setProfile(null);
      setAuthState("guest");
      setLoadingTimedOut(false);
      prevAuthStateRef.current = "guest";
    };

    if (mockMode) {
      clearTimeout(timer);
      const { user: mUser } = getMockState();
      if (mUser) {
        updateToAuthenticated(mUser);
      } else {
        updateToGuest();
      }
    } else {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        clearTimeout(timer);
        updateToGuest();
      } else {
        // 1. Initial session check (getInitialSession)
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!isMounted) return;
          if (session?.user) {
            const u = { id: session.user.id, email: session.user.email || "", created_at: session.user.created_at };
            updateToAuthenticated(u, true);
          } else {
            updateToGuest();
          }
        });

        // 2. Auth state change listener (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT)
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!isMounted) return;
          if (session?.user) {
            const u = { id: session.user.id, email: session.user.email || "", created_at: session.user.created_at };
            updateToAuthenticated(u);
          } else {
            updateToGuest();
          }
        });

        return () => {
          isMounted = false;
          clearTimeout(timer);
          subscription.unsubscribe();
        };
      }
    }

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [mockMode, loadProfile, explicitGuestChosen]);

  // Subscribe to cross-tab auth state changes
  useEffect(() => {
    const unsubscribe = authTabChannel.subscribe((msg) => {
      if (msg.type === "AUTH_SIGNED_IN" || msg.type === "AUTH_CLAIMED") {
        if (mockMode) {
          const { user: mUser, profile: mProfile } = getMockState();
          if (mUser) {
            setUser(mUser);
            setProfile(mProfile);
            setAuthState("authenticated");
          }
        } else {
          const supabase = createSupabaseBrowserClient();
          if (supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
              if (session?.user) {
                const u = { id: session.user.id, email: session.user.email || "", created_at: session.user.created_at };
                setUser(u);
                loadProfile(session.user.id);
                setAuthState("authenticated");
              }
            });
          }
        }
      } else if (msg.type === "AUTH_SIGNED_OUT") {
        setUser(null);
        setProfile(null);
        setAuthState("guest");
        routingExecutedUserIdRef.current = null;
      }
    });

    return () => unsubscribe();
  }, [mockMode, loadProfile]);

  const signInWithOtp = async (email: string) => {
    if (!email || !email.includes("@")) {
      return {
        success: false,
        errorKey: "invalidEmail",
        errorDetails: mapSupabaseError({ status: 400, message: "Invalid email address format" }),
      };
    }

    if (mockMode) {
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return {
        success: false,
        errorKey: "genericError",
        errorDetails: mapSupabaseError({ status: 500, message: "Supabase client not initialized" }),
      };
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const redirectUrl = siteUrl
      ? `${siteUrl.replace(/\/+$/, "")}/auth/callback`
      : typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : undefined;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      const details = mapSupabaseError(error, envInfo.truncatedReason);
      return { success: false, errorKey: details.errorKey, errorDetails: details };
    }

    return { success: true };
  };

  const verifyOtp = async (email: string, token: string, consentAccepted = true) => {
    const cleanToken = token ? token.replace(/\D/g, "") : "";
    if (!cleanToken || cleanToken.length < 6 || cleanToken.length > 8) {
      return {
        success: false,
        errorKey: "invalidOrExpiredCode",
        errorDetails: mapSupabaseError({ status: 400, message: "Verification code must be 6 to 8 digits" }),
      };
    }

    if (!consentAccepted) {
      return {
        success: false,
        errorKey: "consentRequired",
        errorDetails: mapSupabaseError({ status: 400, message: "User consent required" }),
      };
    }

    if (mockMode) {
      if (cleanToken === "999999") {
        return {
          success: false,
          errorKey: "invalidOrExpiredCode",
          errorDetails: mapSupabaseError({ status: 400, message: "Code has expired" }),
        };
      }
      if (cleanToken !== "123456" && cleanToken !== "000000" && cleanToken !== "1234567" && cleanToken !== "12345678") {
        return {
          success: false,
          errorKey: "invalidOrExpiredCode",
          errorDetails: mapSupabaseError({ status: 400, message: "Invalid OTP token" }),
        };
      }

      const mUser: MockUser = {
        id: "mock-user-id-" + Date.now(),
        email,
        created_at: new Date().toISOString(),
      };
      const mProfile: MockProfile = {
        id: mUser.id,
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: new Date().toISOString(),
        consent_version: "1.0-draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setMockState(mUser, mProfile);
      setUser(mUser);
      setProfile(mProfile);
      setAuthState("authenticated");

      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return {
        success: false,
        errorKey: "genericError",
        errorDetails: mapSupabaseError({ status: 500, message: "Supabase client not configured" }),
      };
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: cleanToken,
      type: "email",
    });

    if (error) {
      const details = mapSupabaseError(error, envInfo.truncatedReason);
      return { success: false, errorKey: details.errorKey, errorDetails: details };
    }

    if (data.session?.user) {
      const newUser = {
        id: data.session.user.id,
        email: data.session.user.email || "",
        created_at: data.session.user.created_at,
      };
      setUser(newUser);

      await supabase
        .from("profiles")
        .update({
          consent_at: new Date().toISOString(),
          consent_version: "1.0-draft",
        })
        .eq("id", newUser.id);

      await loadProfile(newUser.id);
      setAuthState("authenticated");
    }

    return { success: true };
  };

  const signOut = async () => {
    const oldSpaceId = AppStorage.getActiveSpaceId();
    await AppStorage.flushSpace(oldSpaceId);

    authTabChannel.broadcast("AUTH_SIGNED_OUT");

    if (mockMode) {
      setMockState(null, null);
      setUser(null);
      setProfile(null);
      setAuthState("guest");
      routingExecutedUserIdRef.current = null;
      AppStorage.setUserId(null);
      spaceTabChannel.notifyLocal(oldSpaceId, GUEST_SPACE_ID);
      spaceTabChannel.broadcastSpaceChange(oldSpaceId, GUEST_SPACE_ID);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setProfile(null);
    setAuthState("guest");
    routingExecutedUserIdRef.current = null;
    AppStorage.setUserId(null);
    spaceTabChannel.notifyLocal(oldSpaceId, GUEST_SPACE_ID);
    spaceTabChannel.broadcastSpaceChange(oldSpaceId, GUEST_SPACE_ID);
  };

  const checkNicknameAvailable = async (nickname: string): Promise<boolean> => {
    if (!nickname || nickname.trim().length < 3 || nickname.trim().length > 24) return false;
    if (mockMode) {
      return mockIsNicknameAvailable(nickname);
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return true;
    }

    try {
      const { data, error } = await supabase.rpc("is_nickname_available", { nick: nickname.trim() });
      if (error) return true;
      return Boolean(data);
    } catch {
      return true;
    }
  };

  const suggestAvailableNickname = async (baseNick: string): Promise<string> => {
    let cleanBase = baseNick.trim().replace(/[^A-Za-z0-9_.-]/g, "");
    if (!cleanBase || cleanBase.length < 3) cleanBase = "Trader";

    const available = await checkNicknameAvailable(cleanBase);
    if (available) return cleanBase;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const suffix = Math.floor(100 + Math.random() * 900);
      const candidate = `${cleanBase.slice(0, 20)}_${suffix}`;
      const isAvail = await checkNicknameAvailable(candidate);
      if (isAvail) return candidate;
    }

    return `${cleanBase.slice(0, 20)}_${Math.floor(100 + Math.random() * 900)}`;
  };

  const saveNickname = async (nickname: string) => {
    const clean = nickname.trim();
    if (!clean || clean.length < 3 || clean.length > 24) {
      return { success: false, errorKey: "errorLength" };
    }

    if (mockMode) {
      const ok = mockSetNickname(clean);
      if (!ok) return { success: false, errorKey: "errorNicknameTaken" };
      const { profile: mProfile } = getMockState();
      setProfile(mProfile);
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase || !user) {
      return { success: false, errorKey: "genericError" };
    }

    const isAvailable = await checkNicknameAvailable(clean);
    if (!isAvailable) {
      return { success: false, errorKey: "errorNicknameTaken" };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ nickname: clean })
      .eq("id", user.id);

    if (error) {
      return { success: false, errorKey: "errorNicknameTaken" };
    }

    await loadProfile(user.id);
    return { success: true };
  };

  const refreshProfile = async () => {
    if (user) {
      await loadProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        authState,
        loadingTimedOut,
        user,
        profile,
        activeSpaceId,
        isLoading: authState === "loading",
        isGuest: authState === "guest",
        isConfigured: envInfo.isConfigured || mockMode,
        guestDismissed,
        setGuestDismissed,
        lateSignInNotice,
        dismissLateSignInNotice,
        explicitGuestChosen,
        chooseGuestExplicitly,
        lastRouteReason,
        signInWithOtp,
        verifyOtp,
        signOut,
        checkNicknameAvailable,
        saveNickname,
        refreshProfile,
        suggestAvailableNickname,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
