import { safeNextAfterLogin } from "./post-login";
import { isValidLatinNickname } from "@/lib/stats";
import { AppStorage } from "@/lib/storage";
import type { UserProfile, AuthUser } from "./auth-context";

export { POST_LOGIN_ROUTER, safeNextAfterLogin, postLoginRouterUrl } from "./post-login";

/** True when the cloud profile has a nickname, i.e. the account finished onboarding (on any device). */
export function hasCloudNickname(profile: Pick<UserProfile, "nickname"> | null | undefined): boolean {
  return Boolean(profile?.nickname && profile.nickname.trim().length >= 3);
}

/**
 * Reads the game state stored in the signed-in account's own space (never the guest space),
 * regardless of which space is active at the moment of the call.
 */
export function readAccountGameState(userId: string): any {
  try {
    const raw = AppStorage.getItem("ayra_demo_v1", userId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface ResolveRouteOptions {
  user: AuthUser | null;
  profile: UserProfile | null;
  rawNextParam?: string | null;
  /** Game state stored in the signed-in account's own space (historical name; never the guest space). */
  guestState?: any;
  checkNicknameAvailable?: (nick: string) => Promise<boolean>;
  saveNickname?: (nick: string) => Promise<{ success: boolean }>;
  updateProfile?: (updates: Partial<UserProfile>) => Promise<boolean>;
}

export interface ResolveRouteResult {
  destination: string;
  source: "cloud" | "onboarding_answers" | "guest_name" | "conflict" | "guest_in_progress";
  nicknameConflict?: boolean;
  candidateNickname?: string;
}

/**
 * Unified post-login route resolver function (T7a.3).
 * Evaluates whether user needs to complete awakening, resolve nickname conflicts,
 * or proceed to their target destination.
 */
export async function resolvePostLoginRoute(options: ResolveRouteOptions): Promise<ResolveRouteResult> {
  const {
    user,
    profile,
    rawNextParam,
    guestState,
    checkNicknameAvailable,
    saveNickname,
    updateProfile,
  } = options;

  if (!user) {
    return { destination: "/login", source: "cloud" };
  }

  const safeNext = safeNextAfterLogin(rawNextParam);

  // Rule 1: If cloud profile already has a nickname, local nickname NEVER overwrites it.
  if (hasCloudNickname(profile)) {
    return {
      destination: safeNext,
      source: "cloud",
    };
  }

  // Cloud profile has no nickname (null or empty).
  // Extract candidate nickname from local guest state.
  const answersNick = guestState?.onboarding?.answers?.nickname;
  const guestName = guestState?.name;

  let candidate = "";
  let nickSource: "onboarding_answers" | "guest_name" = "onboarding_answers";

  if (answersNick && typeof answersNick === "string" && answersNick.trim().length > 0) {
    candidate = answersNick.trim();
    nickSource = "onboarding_answers";
  } else if (guestName && typeof guestName === "string" && guestName.trim().length > 0) {
    candidate = guestName.trim();
    nickSource = "guest_name";
  }

  const isOnboardingDone = guestState?.onboarding?.status === "done";

  // Rule 2: If local onboarding is NOT completed, do not auto-save anything.
  // Send user to /awakening to continue onboarding.
  if (!isOnboardingDone) {
    return {
      destination: "/awakening",
      source: "guest_in_progress",
      candidateNickname: candidate || undefined,
    };
  }

  // Local onboarding IS completed. Check if candidate nickname is valid Latin format.
  if (!candidate || !isValidLatinNickname(candidate)) {
    return {
      destination: "/awakening?mode=conflict",
      source: "conflict",
      nicknameConflict: true,
      candidateNickname: candidate,
    };
  }

  // Check if candidate nickname is available in DB
  const isAvailable = checkNicknameAvailable ? await checkNicknameAvailable(candidate) : true;

  if (!isAvailable) {
    return {
      destination: "/awakening?mode=conflict",
      source: "conflict",
      nicknameConflict: true,
      candidateNickname: candidate,
    };
  }

  // Nickname is available! Save nickname and transfer profile fields.
  if (saveNickname) {
    const saveRes = await saveNickname(candidate);
    if (!saveRes.success) {
      return {
        destination: "/awakening?mode=conflict",
        source: "conflict",
        nicknameConflict: true,
        candidateNickname: candidate,
      };
    }
  }

  // Transfer allowable profile fields (locale, timezone, age_group)
  if (updateProfile && guestState) {
    const answers = guestState.onboarding?.answers || {};
    const updates: Partial<UserProfile> = {};

    if (answers.language && (answers.language === "ru" || answers.language === "en")) {
      updates.locale = answers.language;
    }
    if (answers.timezone) {
      updates.timezone = answers.timezone;
    }
    if (answers.ageRange) {
      updates.age_group = answers.ageRange;
    }

    if (Object.keys(updates).length > 0) {
      await updateProfile(updates);
    }
  }

  return {
    destination: safeNext,
    source: nickSource,
  };
}
