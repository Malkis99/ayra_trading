"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isE2EMockEnabled, getSupabaseEnv } from "@/lib/supabase/config";
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
  signInWithOtp: (email: string) => Promise<{ success: boolean; errorKey?: string; message?: string }>;
  verifyOtp: (
    email: string,
    token: string,
    consentAccepted?: boolean
  ) => Promise<{ success: boolean; errorKey?: string; message?: string }>;
  signOut: () => Promise<void>;
  checkNicknameAvailable: (nickname: string) => Promise<boolean>;
  saveNickname: (nickname: string) => Promise<{ success: boolean; errorKey?: string }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { isConfigured } = getSupabaseEnv();
  const mockMode = isE2EMockEnabled();

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
    if (mockMode) {
      const { user: mUser, profile: mProfile } = getMockState();
      setUser(mUser);
      setProfile(mProfile);
      setIsLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email || "", created_at: session.user.created_at });
        loadProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email || "", created_at: session.user.created_at });
        loadProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [mockMode, loadProfile]);

  const signInWithOtp = async (email: string) => {
    if (!email || !email.includes("@")) {
      return { success: false, errorKey: "invalidEmail" };
    }

    if (mockMode) {
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return { success: false, errorKey: "genericError" };
    }

    const redirectUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : undefined;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      if (error.status === 429) {
        return { success: false, errorKey: "rateLimit" };
      }
      return { success: false, errorKey: "genericError", message: error.message };
    }

    return { success: true };
  };

  const verifyOtp = async (email: string, token: string, consentAccepted = true) => {
    if (!token || token.trim().length !== 6) {
      return { success: false, errorKey: "invalidCode" };
    }

    if (!consentAccepted) {
      return { success: false, errorKey: "consentRequired" };
    }

    if (mockMode) {
      const cleanToken = token.trim();
      if (cleanToken === "999999") {
        return { success: false, errorKey: "expiredCode" };
      }
      if (cleanToken !== "123456" && cleanToken !== "000000") {
        return { success: false, errorKey: "invalidCode" };
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
      return { success: false, errorKey: "genericError" };
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      if (error.message?.toLowerCase().includes("expired")) {
        return { success: false, errorKey: "expiredCode" };
      }
      return { success: false, errorKey: "invalidCode", message: error.message };
    }

    if (data.session?.user) {
      const newUser = {
        id: data.session.user.id,
        email: data.session.user.email || "",
        created_at: data.session.user.created_at,
      };
      setUser(newUser);

      // Save consent info in profiles table
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
    if (mockMode) {
      return mockIsNicknameAvailable(nickname);
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return true; // Guest mode / offline
    }

    try {
      const { data, error } = await supabase.rpc("is_nickname_available", { nick: nickname });
      if (error) return true;
      return Boolean(data);
    } catch {
      return true;
    }
  };

  const saveNickname = async (nickname: string) => {
    if (mockMode) {
      const ok = mockSetNickname(nickname);
      if (!ok) return { success: false, errorKey: "errorNicknameTaken" };
      const { profile: mProfile } = getMockState();
      setProfile(mProfile);
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase || !user) {
      return { success: false, errorKey: "genericError" };
    }

    const isAvailable = await checkNicknameAvailable(nickname);
    if (!isAvailable) {
      return { success: false, errorKey: "errorNicknameTaken" };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ nickname })
      .eq("id", user.id);

    if (error) {
      return { success: false, errorKey: "genericError" };
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
        isConfigured: isConfigured || mockMode,
        signInWithOtp,
        verifyOtp,
        signOut,
        checkNicknameAvailable,
        saveNickname,
        refreshProfile,
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
