export interface MockUser {
  id: string;
  email: string;
  created_at: string;
}

export interface MockProfile {
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
  /** Set by the server (migration 0003) on every nickname change after the first one. */
  nickname_changed_at?: string | null;
}

import { AppStorage } from "@/lib/storage";
import { nicknameDaysLeft } from "@/lib/profile";

const TAKEN_NICKNAMES = new Set(["taken_nick", "existing_trader", "admin", "ayra_official"]);
const MOCK_STORAGE_KEY = "ayra_mock_auth_v1";

export function getMockState(): { user: MockUser | null; profile: MockProfile | null } {
  if (typeof window === "undefined") {
    return { user: null, profile: null };
  }
  try {
    const data = AppStorage.getItem(MOCK_STORAGE_KEY);
    if (!data) return { user: null, profile: null };
    return JSON.parse(data);
  } catch {
    return { user: null, profile: null };
  }
}

export function setMockState(user: MockUser | null, profile: MockProfile | null) {
  if (typeof window === "undefined") return;
  try {
    if (!user) {
      AppStorage.removeItem(MOCK_STORAGE_KEY);
    } else {
      AppStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ user, profile }));
    }
  } catch {
    // Ignore storage errors
  }
}

export function mockIsNicknameAvailable(nick: string): boolean {
  if (!nick || !/^[A-Za-z0-9_.-]{3,24}$/.test(nick)) {
    return false;
  }
  const { profile } = getMockState();
  if (profile && profile.nickname && profile.nickname.toLowerCase() === nick.toLowerCase()) {
    return true; // Own nickname is always available for self
  }
  if (TAKEN_NICKNAMES.has(nick.toLowerCase())) {
    return false;
  }
  return true;
}

/** Same rules as the server: unique, format, and (after the first nickname) one change per 14 days. */
export function mockSetNickname(nick: string): { ok: true } | { ok: false; reason: "taken" | "cooldown" } {
  if (!mockIsNicknameAvailable(nick)) {
    return { ok: false, reason: "taken" };
  }
  let { user, profile } = getMockState();
  if (!user) {
    user = {
      id: "mock-user-id-default",
      email: "mock@example.com",
      created_at: new Date().toISOString(),
    };
  }

  const updatedProfile: MockProfile = profile || {
    id: user.id,
    nickname: null,
    locale: "ru",
    timezone: "UTC",
    age_group: "18-24",
    minor_mode: false,
    consent_at: new Date().toISOString(),
    consent_version: "1.0-draft",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const previous = updatedProfile.nickname;
  // e2e can emulate the server before migration 0003 (no nickname_changed_at column, no 14-day trigger)
  const before0003 = typeof window !== "undefined" && Boolean((window as unknown as { __AYRA_MOCK_BEFORE_0003__?: boolean }).__AYRA_MOCK_BEFORE_0003__);
  if (before0003) delete updatedProfile.nickname_changed_at;
  if (!before0003 && previous && previous !== nick) {
    if (nicknameDaysLeft(updatedProfile.nickname_changed_at ?? null) > 0) return { ok: false, reason: "cooldown" };
    updatedProfile.nickname_changed_at = new Date().toISOString();
  }
  updatedProfile.nickname = nick;
  updatedProfile.updated_at = new Date().toISOString();
  setMockState(user, updatedProfile);
  TAKEN_NICKNAMES.add(nick.toLowerCase());
  return { ok: true };
}
