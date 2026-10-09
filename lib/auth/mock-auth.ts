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
}

const TAKEN_NICKNAMES = new Set(["taken_nick", "existing_trader", "admin", "ayra_official"]);
const MOCK_STORAGE_KEY = "ayra_mock_auth_v1";

export function getMockState(): { user: MockUser | null; profile: MockProfile | null } {
  if (typeof window === "undefined") {
    return { user: null, profile: null };
  }
  try {
    const data = localStorage.getItem(MOCK_STORAGE_KEY);
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
      localStorage.removeItem(MOCK_STORAGE_KEY);
    } else {
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ user, profile }));
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

export function mockSetNickname(nick: string): boolean {
  if (!mockIsNicknameAvailable(nick)) {
    return false;
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

  updatedProfile.nickname = nick;
  updatedProfile.updated_at = new Date().toISOString();
  setMockState(user, updatedProfile);
  TAKEN_NICKNAMES.add(nick.toLowerCase());
  return true;
}
