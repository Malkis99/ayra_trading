import { describe, it, expect, beforeEach } from "vitest";
import { markSetupSeen, readSetupSeen, setupWindowMode, type SetupWindowInput } from "./setup-window";
import { AppStorage } from "@/lib/storage";

const base: SetupWindowInput = { signedIn: true, seen: false, cloudFlagKnown: true, cloudActive: false, journalEmpty: true, preferencesSet: false };

describe("who sees the Journal setup window (plan section 5)", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });

  it("guests never; seen never; not before the server answered about the cloud", () => {
    expect(setupWindowMode({ ...base, signedIn: false })).toBeNull();
    expect(setupWindowMode({ ...base, seen: true })).toBeNull();
    expect(setupWindowMode({ ...base, cloudFlagKnown: false })).toBeNull();
  });

  it("cloud off: a new account sees it, an existing user with a journal does not", () => {
    expect(setupWindowMode(base)).toBe("full");
    expect(setupWindowMode({ ...base, journalEmpty: false })).toBeNull();
    expect(setupWindowMode({ ...base, preferencesSet: true })).toBeNull();
  });

  it("cloud on: once for everyone; settings already there (another device / Settings) → only the cloud question", () => {
    expect(setupWindowMode({ ...base, cloudActive: true, journalEmpty: false })).toBe("full");
    expect(setupWindowMode({ ...base, cloudActive: true, preferencesSet: true })).toBe("cloudOnly");
  });

  it("«seen» is per account on this device", () => {
    const A = "00000000-0000-0000-0000-0000000000a1";
    const B = "00000000-0000-0000-0000-0000000000b1";
    AppStorage.setUserId(A);
    markSetupSeen(A);
    expect(readSetupSeen(A)).toBe(true);
    AppStorage.setUserId(B);
    expect(readSetupSeen(B)).toBe(false);
    AppStorage.setUserId(null);
  });
});
