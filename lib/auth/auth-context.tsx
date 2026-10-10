"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isE2EMockEnabled, getSupabaseEnv } from "@/lib/supabase/config";
import { mapSupabaseError, type SanitizedErrorInfo } from "./error-sanitizer";
import {
  getMockState,
  setMockState,
  mockIsNicknameAvailable,
  mockSetNickname,
  type MockUser,
  type MockProfile,
} from "./mock-auth";

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
  user: AuthUser | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isGuest: boolean;
  isConfigured: boolean;
  guestDismissed: boolean;
  setGuestDismissed: (val: boolean) => void;
  lateSignInNotice: boolean;
  dismissLateSignInNotice: () => void;
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [guestDismissed, setGuestDismissedState] = useState(false);
  const [lateSignInNotice, setLateSignInNotice] = useState(false);

  const initialResolvedRef = useRef(false);
  const envInfo = getSupabaseEnv();
  const mockMode = isE2EMockEnabled();

  const setGuestDismissed = (val: boolean) => {
    setGuestDismissedState(val);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("ayra_guest_dismissed", val ? "1" : "0");
      } catch {}
    }
  };

  const dismissLateSignInNotice = () => {
    setLateSignInNotice(false);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const d = localStorage.getItem("ayra_guest_dismissed");
        if (d === "1") setGuestDismissedState(true);
      } catch {}
    }
  }, []);

  const loadProfile = useCallback(
    async (userId: string) => {
      if (mockMode) {
        const { profile: mProfile } = getMockState();
        setProfile(mProfile);
        return;
      }

      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;

      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();

      if (!error && data) {
        setProfile(data as UserProfile);
      }
    },
    [mockMode]
  );

  useEffect(() => {
    // 1.5s timeout guard to prevent UI locking on slow auth resolution
    const timer = setTimeout(() => {
      if (!initialResolvedRef.current) {
        initialResolvedRef.current = true;
        setIsLoading(false);
      }
    }, 1500);

    if (mockMode) {
      clearTimeout(timer);
      const { user: mUser, profile: mProfile } = getMockState();
      setUser(mUser);
      setProfile(mProfile);
      initialResolvedRef.current = true;
      setIsLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      clearTimeout(timer);
      initialResolvedRef.current = true;
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timer);
      if (session?.user) {
        const u = { id: session.user.id, email: session.user.email || "", created_at: session.user.created_at };
        setUser(u);
        loadProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
      initialResolvedRef.current = true;
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = { id: session.user.id, email: session.user.email || "", created_at: session.user.created_at };
        setUser(u);
        loadProfile(session.user.id);
        if (initialResolvedRef.current && !user) {
          // Late sign-in detected after timeout
          setLateSignInNotice(true);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      initialResolvedRef.current = true;
      setIsLoading(false);
    });

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
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
    }

    return { success: true };
  };

  const signOut = async () => {
    if (mockMode) {
      setMockState(null, null);
      setUser(null);
      setProfile(null);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setProfile(null);
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
      const suffix = Math.floor(100 + Math.random() * 900); // 3-digit suffix
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
        user,
        profile,
        isLoading,
        isGuest: !user,
        isConfigured: envInfo.isConfigured || mockMode,
        guestDismissed,
        setGuestDismissed,
        lateSignInNotice,
        dismissLateSignInNotice,
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
