"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { createSupabaseBrowserClient, createSupabaseCheckClient } from "@/lib/supabase/browser";
import { isAlreadyRegistered, passwordProblem, passwordUpdateErrorKey, signInErrorKey } from "./password";
import { isE2EMockEnabled, getSupabaseEnv } from "@/lib/supabase/config";
import { mapSupabaseError, type SanitizedErrorInfo } from "./error-sanitizer";
import { authTabChannel } from "./tab-channel";
import { spaceTabChannel } from "./space-channel";
import { AppStorage, GUEST_SPACE_ID } from "@/lib/storage";
import {
  getMockState,
  setMockState,
  getMockAccounts,
  saveMockAccount,
  getMockProfile,
  mockProfileFor,
  mockIsNicknameAvailable,
  mockSetNickname,
  type MockUser,
  type MockProfile,
} from "./mock-auth";

export type AuthState = "loading" | "guest" | "authenticated";

/** Result of the last cloud profile read: "missing" = no row, "error" = the read failed (retry). */
export type ProfileStatus = "idle" | "loading" | "loaded" | "missing" | "error";

/** Why the last profile read failed (diagnostics only; no tokens or personal data). */
export interface ProfileLoadError {
  status: number | null;
  code: string | null;
  message: string;
}

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
  /** Last nickname change after onboarding; present once migration 0003 is applied. */
  nickname_changed_at?: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  created_at?: string;
  /** The account has a password (set in Settings or by «Forgot password»); accounts made by the e-mail code have none. */
  hasPassword?: boolean;
}

/** Supabase session user -> AuthUser. `has_password` is a UI hint in user_metadata, not a security check. */
function toAuthUser(u: { id: string; email?: string | null; created_at?: string; user_metadata?: Record<string, unknown> | null }): AuthUser {
  return { id: u.id, email: u.email || "", created_at: u.created_at, hasPassword: u.user_metadata?.has_password === true };
}

export type SetPasswordResult = { success: boolean; errorKey?: string; errorDetails?: SanitizedErrorInfo };
export type AuthResult = SetPasswordResult;

/** e2e auth mock only: codes the mock accepts (the real server sends its own). */
const MOCK_VALID_CODES = new Set(["123456", "000000", "1234567", "12345678"]);

interface AuthContextType {
  authState: AuthState;
  loadingTimedOut: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  profileStatus: ProfileStatus;
  profileError: ProfileLoadError | null;
  activeSpaceId: string;
  /** True once local storage and providers have actually switched to activeSpaceId. */
  isSpaceReady: boolean;
  isLoading: boolean;
  isGuest: boolean;
  isConfigured: boolean;
  /** Not signed in and did not choose "continue without signing in": sees only public content. */
  isPublicVisitor: boolean;
  guestDismissed: boolean;
  setGuestDismissed: (val: boolean) => void;
  lateSignInNotice: boolean;
  dismissLateSignInNotice: () => void;
  explicitGuestChosen: boolean;
  chooseGuestExplicitly: () => void;
  lastRouteReason: string | null;
  reportRouteReason: (reason: string) => void;
  /** E-mail + password; no e-mail is sent. */
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  /** E-mail + password + consent; the e-mail is then confirmed with the code (verifyOtp). */
  signUpWithPassword: (email: string, password: string, consentAccepted: boolean) => Promise<AuthResult & { signedIn?: boolean }>;
  resendSignupCode: (email: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  completePasswordReset: (email: string, code: string, newPassword: string) => Promise<AuthResult>;
  verifyOtp: (
    email: string,
    token: string,
    consentAccepted?: boolean
  ) => Promise<{ success: boolean; errorKey?: string; errorDetails?: SanitizedErrorInfo }>;
  signOut: () => Promise<void>;
  /** Creates (no currentPassword) or changes the password of the signed-in account. Sends no e-mail. */
  setPassword: (newPassword: string, currentPassword?: string) => Promise<SetPasswordResult>;
  checkNicknameAvailable: (nickname: string) => Promise<boolean>;
  saveNickname: (nickname: string) => Promise<{ success: boolean; errorKey?: string }>;
  refreshProfile: () => Promise<void>;
  suggestAvailableNickname: (baseNick: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Server errors of a nickname update -> dictionary keys (unique, format check, 14-day rule from migration 0003). */
export function nicknameErrorKey(code: string | null | undefined, message: string | null | undefined): string {
  if (code === "23505") return "errorNicknameTaken";
  if (code === "23514") return "errorLatin";
  if (/nickname_change_cooldown/.test(message ?? "")) return "nicknameCooldown";
  return "genericError";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");
  const [profileError, setProfileError] = useState<ProfileLoadError | null>(null);
  const [guestDismissed, setGuestDismissedState] = useState(false);
  const [explicitGuestChosen, setExplicitGuestChosen] = useState(false);
  const [lateSignInNotice, setLateSignInNotice] = useState(false);
  const [lastRouteReason, setLastRouteReason] = useState<string | null>(null);

  const prevAuthStateRef = useRef<AuthState>("loading");

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

  const [readySpaceId, setReadySpaceId] = useState<string | null>(null);

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
      const target = authState === "authenticated" && user ? `account:${user.id}` : GUEST_SPACE_ID;
      switchSpaceTo(authState, user ? user.id : null).then(() => setReadySpaceId(target));
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
        setProfileStatus(mProfile ? "loaded" : "missing");
        return mProfile;
      }

      const fail = (err: ProfileLoadError) => {
        setProfileError(err);
        setProfileStatus((s) => (s === "loaded" ? s : "error"));
        return null;
      };

      const supabase = createSupabaseBrowserClient();
      if (!supabase) return fail({ status: null, code: null, message: "Supabase client not configured" });

      setProfileStatus((s) => (s === "loaded" ? s : "loading"));
      try {
        // No row is a normal state (new account, nickname not chosen yet), not an error.
        const { data, error, status } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
        if (error) return fail({ status: status ?? null, code: error.code ?? null, message: error.message ?? "" });
        setProfileError(null);
        if (!data) {
          setProfile(null);
          setProfileStatus("missing");
          return null;
        }
        const prof = data as UserProfile;
        setProfile(prof);
        setProfileStatus("loaded");
        return prof;
      } catch (e) {
        return fail({ status: null, code: "network", message: e instanceof Error ? e.message : String(e) });
      }
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

      // Where to go after sign-in is decided only by /auth/continue (lib/auth/routing.ts).
      prevAuthStateRef.current = "authenticated";
    };

    const updateToGuest = () => {
      setUser(null);
      setProfile(null);
      setProfileStatus("idle");
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
            const u = toAuthUser(session.user);
            updateToAuthenticated(u, true);
            // The stored session may hold old user data (a password set on another device): refresh only that flag
            supabase.auth
              .getUser()
              .then(({ data }) => {
                if (!isMounted || !data.user) return;
                const fresh = toAuthUser(data.user);
                setUser((prev) => (prev && prev.id === fresh.id && prev.hasPassword !== fresh.hasPassword ? { ...prev, hasPassword: fresh.hasPassword } : prev));
              })
              .catch(() => {});
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
            const u = toAuthUser(session.user);
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
            setProfileStatus(mProfile ? "loaded" : "missing");
            setAuthState("authenticated");
          }
        } else {
          const supabase = createSupabaseBrowserClient();
          if (supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
              if (session?.user) {
                const u = toAuthUser(session.user);
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
      }
    });

    return () => unsubscribe();
  }, [mockMode, loadProfile]);

  const authRedirectUrl = () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    return siteUrl
      ? `${siteUrl.replace(/\/+$/, "")}/auth/callback`
      : typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : undefined;
  };

  const notConfigured = (): AuthResult => ({
    success: false,
    errorKey: "genericError",
    errorDetails: mapSupabaseError({ status: 500, message: "Supabase client not initialized" }),
  });

  const invalidEmail = (email: string): AuthResult | null =>
    !email || !email.includes("@")
      ? { success: false, errorKey: "invalidEmail", errorDetails: mapSupabaseError({ status: 400, message: "Invalid email address format" }) }
      : null;

  const passwordRuleError = (password: string): AuthResult | null => {
    const problem = passwordProblem(password);
    if (!problem) return null;
    const key = problem === "blank" ? "passwordBlank" : problem === "tooShort" ? "passwordTooShort" : "passwordTooLong";
    return { success: false, errorKey: key };
  };

  /** Sign in with e-mail and password. Sends no e-mail. */
  const signInWithPassword = async (email: string, password: string): Promise<AuthResult> => {
    const bad = invalidEmail(email);
    if (bad) return bad;
    if (!password) return { success: false, errorKey: "passwordBlank" };

    if (mockMode) {
      const account = getMockAccounts()[email.toLowerCase()];
      if (!account || account.password !== password) {
        return { success: false, errorKey: "invalidCredentials", errorDetails: mapSupabaseError({ status: 400, message: "Invalid login credentials" }) };
      }
      if (!account.confirmed) {
        return { success: false, errorKey: "emailNotConfirmed", errorDetails: mapSupabaseError({ status: 400, message: "Email not confirmed" }) };
      }
      const { profile: stored } = getMockState();
      const mUser: MockUser = { id: account.id, email: account.email, created_at: account.created_at, hasPassword: true, mockPassword: account.password };
      const mProfile = stored && stored.id === account.id ? stored : getMockProfile(account.id) ?? mockProfileFor(account.id);
      setMockState(mUser, mProfile);
      setUser({ id: mUser.id, email: mUser.email, created_at: mUser.created_at, hasPassword: true });
      setProfile(mProfile);
      setProfileStatus("loaded");
      setAuthState("authenticated");
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return notConfigured();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { success: false, errorKey: signInErrorKey(error), errorDetails: mapSupabaseError(error, envInfo.truncatedReason) };
    }
    return { success: true };
  };

  /**
   * Sign up with e-mail and password; the e-mail is confirmed by the code from the letter (verifyOtp).
   * An e-mail that already has an account gets the same answer (the code screen), so registration never reveals it.
   */
  const signUpWithPassword = async (email: string, password: string, consentAccepted: boolean): Promise<AuthResult & { signedIn?: boolean }> => {
    const bad = invalidEmail(email);
    if (bad) return bad;
    const rule = passwordRuleError(password);
    if (rule) return rule;
    if (!consentAccepted) {
      return { success: false, errorKey: "consentRequired", errorDetails: mapSupabaseError({ status: 400, message: "User consent required" }) };
    }

    if (mockMode) {
      if (!getMockAccounts()[email.toLowerCase()]) {
        saveMockAccount({ id: "mock-user-id-" + Date.now(), email, password, confirmed: false, created_at: new Date().toISOString() });
      }
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return notConfigured();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirectUrl(), data: { has_password: true } },
    });
    if (error && !isAlreadyRegistered(error)) {
      const details = mapSupabaseError(error, envInfo.truncatedReason);
      const key = passwordUpdateErrorKey(error) === "tooShort" ? "passwordTooShort" : details.errorKey;
      return { success: false, errorKey: key, errorDetails: details };
    }
    // «Confirm email» off in the panel: Supabase signs in right away
    if (data?.session) {
      await supabase.from("profiles").update({ consent_at: new Date().toISOString(), consent_version: "1.0-draft" }).eq("id", data.session.user.id);
      return { success: true, signedIn: true };
    }
    return { success: true };
  };

  /** Sends the sign-up confirmation code again (also for «Email not confirmed» on sign-in). */
  const resendSignupCode = async (email: string): Promise<AuthResult> => {
    const bad = invalidEmail(email);
    if (bad) return bad;
    if (mockMode) return { success: true };
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return notConfigured();
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: authRedirectUrl() } });
    if (error) {
      const details = mapSupabaseError(error, envInfo.truncatedReason);
      return { success: false, errorKey: details.errorKey, errorDetails: details };
    }
    return { success: true };
  };

  /**
   * «Forgot password»: sends a code when the e-mail has an account. The answer is the same either way;
   * only a sending limit or no network is shown (they say nothing about the e-mail).
   */
  const requestPasswordReset = async (email: string): Promise<AuthResult> => {
    const bad = invalidEmail(email);
    if (bad) return bad;
    if (mockMode) return { success: true };
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return notConfigured();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
    if (error) {
      const details = mapSupabaseError(error, envInfo.truncatedReason);
      if (details.errorKey === "rateLimitExceeded" || details.errorKey === "networkError") {
        return { success: false, errorKey: details.errorKey, errorDetails: details };
      }
    }
    return { success: true };
  };

  /** Code from the «Forgot password» letter + new password -> signed in here, every other device signed out. */
  const completePasswordReset = async (email: string, code: string, newPassword: string): Promise<AuthResult> => {
    const cleanCode = code.replace(/\D/g, "");
    if (cleanCode.length < 6 || cleanCode.length > 8) {
      return { success: false, errorKey: "invalidOrExpiredCode", errorDetails: mapSupabaseError({ status: 400, message: "Verification code must be 6 to 8 digits" }) };
    }
    const rule = passwordRuleError(newPassword);
    if (rule) return rule;

    if (mockMode) {
      const account = getMockAccounts()[email.toLowerCase()];
      if (!MOCK_VALID_CODES.has(cleanCode) || !account) {
        return { success: false, errorKey: "invalidOrExpiredCode", errorDetails: mapSupabaseError({ status: 400, message: "Invalid OTP token" }) };
      }
      saveMockAccount({ ...account, password: newPassword, confirmed: true });
      return signInWithPassword(email, newPassword);
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return notConfigured();
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: cleanCode, type: "recovery" });
    if (verifyError) {
      const details = mapSupabaseError(verifyError, envInfo.truncatedReason);
      return { success: false, errorKey: details.errorKey === "rateLimitExceeded" ? "tooManyAttempts" : "invalidOrExpiredCode", errorDetails: details };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword, data: { has_password: true } });
    if (error) {
      const key = passwordUpdateErrorKey(error);
      return {
        success: false,
        errorKey: key === "tooShort" ? "passwordTooShort" : key === "samePassword" ? "samePassword" : "genericError",
        errorDetails: mapSupabaseError(error, envInfo.truncatedReason),
      };
    }
    // Owner decision 4: after a reset every other device is signed out (in case the password leaked)
    await supabase.auth.signOut({ scope: "others" }).catch(() => {});
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

      // The account registered on the sign-up tab (with its password); confirming the code marks it confirmed
      const account = getMockAccounts()[email.toLowerCase()] ?? {
        id: "mock-user-id-" + Date.now(),
        email,
        password: "",
        confirmed: true,
        created_at: new Date().toISOString(),
      };
      saveMockAccount({ ...account, confirmed: true });
      const mUser: MockUser = {
        id: account.id,
        email,
        created_at: account.created_at,
        hasPassword: Boolean(account.password),
        mockPassword: account.password || undefined,
      };
      const mProfile: MockProfile = { ...(getMockProfile(account.id) ?? mockProfileFor(account.id)), consent_at: new Date().toISOString(), consent_version: "1.0-draft" };

      setMockState(mUser, mProfile);
      setUser(mUser);
      setProfile(mProfile);
      setProfileStatus(mProfile ? "loaded" : "missing");
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
      const newUser = toAuthUser(data.session.user);
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
    AppStorage.setUserId(null);
    spaceTabChannel.notifyLocal(oldSpaceId, GUEST_SPACE_ID);
    spaceTabChannel.broadcastSpaceChange(oldSpaceId, GUEST_SPACE_ID);
  };

  const setPassword = async (newPassword: string, currentPassword?: string): Promise<SetPasswordResult> => {
    const problem = passwordProblem(newPassword);
    if (problem) {
      return { success: false, errorKey: problem, errorDetails: mapSupabaseError({ status: 400, message: `Password rule: ${problem}` }) };
    }
    if (!user) {
      return { success: false, errorKey: "generic", errorDetails: mapSupabaseError({ status: 401, message: "Not signed in" }) };
    }
    const changing = currentPassword !== undefined;

    if (mockMode) {
      const { user: mUser, profile: mProfile } = getMockState();
      if (!mUser) return { success: false, errorKey: "generic" };
      if (changing && currentPassword !== mUser.mockPassword) {
        return { success: false, errorKey: "wrongCurrent", errorDetails: mapSupabaseError({ status: 400, message: "Invalid login credentials" }) };
      }
      if (mUser.mockPassword === newPassword) {
        return { success: false, errorKey: "samePassword", errorDetails: mapSupabaseError({ status: 422, message: "same_password" }) };
      }
      const next: MockUser = { ...mUser, hasPassword: true, mockPassword: newPassword };
      setMockState(next, mProfile);
      setUser({ id: next.id, email: next.email, created_at: next.created_at, hasPassword: true });
      return { success: true };
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return { success: false, errorKey: "generic", errorDetails: mapSupabaseError({ status: 500, message: "Supabase client not configured" }) };
    }

    // Changing: check the current password on a throwaway client, so the app's own session is never replaced
    if (changing) {
      const check = createSupabaseCheckClient();
      if (!check) return { success: false, errorKey: "generic" };
      const { error } = await check.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (error) {
        const details = mapSupabaseError(error, envInfo.truncatedReason);
        const key = details.errorKey === "rateLimitExceeded" ? "tooManyAttempts" : details.errorKey === "networkError" ? "network" : "wrongCurrent";
        return { success: false, errorKey: key, errorDetails: details };
      }
      await check.auth.signOut({ scope: "local" }).catch(() => {});
    }

    const { data, error } = await supabase.auth.updateUser({ password: newPassword, data: { has_password: true } });
    if (error) {
      return { success: false, errorKey: passwordUpdateErrorKey(error), errorDetails: mapSupabaseError(error, envInfo.truncatedReason) };
    }
    if (data.user) setUser(toAuthUser(data.user));
    return { success: true };
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
      const res = mockSetNickname(clean);
      if (!res.ok) return { success: false, errorKey: res.reason === "cooldown" ? "nicknameCooldown" : "errorNicknameTaken" };
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

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ nickname: clean })
      .eq("id", user.id)
      .select("id");

    if (error) {
      return { success: false, errorKey: nicknameErrorKey(error.code, error.message) };
    }
    // No profile row on the server: the nickname was not stored anywhere.
    if (!updated || updated.length === 0) {
      return { success: false, errorKey: "profileMissing" };
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
        profileStatus,
        profileError,
        activeSpaceId,
        isSpaceReady: authState !== "loading" && readySpaceId === activeSpaceId,
        isLoading: authState === "loading",
        isGuest: authState === "guest",
        isConfigured: envInfo.isConfigured || mockMode,
        isPublicVisitor: authState === "guest" && (envInfo.isConfigured || mockMode) && !guestDismissed,
        guestDismissed,
        setGuestDismissed,
        lateSignInNotice,
        dismissLateSignInNotice,
        explicitGuestChosen,
        chooseGuestExplicitly,
        lastRouteReason,
        reportRouteReason: setLastRouteReason,
        signInWithPassword,
        signUpWithPassword,
        resendSignupCode,
        requestPasswordReset,
        completePasswordReset,
        verifyOtp,
        signOut,
        setPassword,
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
