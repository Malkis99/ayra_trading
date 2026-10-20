import { describe, it, expect } from "vitest";
import { passwordProblem, passwordUpdateErrorKey } from "./password";
import { getDictionary } from "@/lib/i18n";

describe("password rule (auth plan, owner decision 2)", () => {
  it("8 characters or more, any composition", () => {
    expect(passwordProblem("abcdefgh")).toBeNull();
    expect(passwordProblem("пароль12")).toBeNull();
    expect(passwordProblem("rainy morning trades")).toBeNull();
    expect(passwordProblem("abcdefg")).toBe("tooShort");
  });

  it("empty or only spaces is refused", () => {
    expect(passwordProblem("")).toBe("blank");
    expect(passwordProblem("          ")).toBe("blank");
  });

  it("over 72 bytes (what Supabase keeps) is refused; Cyrillic counts 2 bytes a letter", () => {
    expect(passwordProblem("a".repeat(72))).toBeNull();
    expect(passwordProblem("a".repeat(73))).toBe("tooLong");
    expect(passwordProblem("я".repeat(36))).toBeNull();
    expect(passwordProblem("я".repeat(37))).toBe("tooLong");
  });

  it("Supabase answers map to clear messages", () => {
    expect(passwordUpdateErrorKey({ code: "same_password" })).toBe("samePassword");
    expect(passwordUpdateErrorKey({ code: "weak_password" })).toBe("tooShort");
    expect(passwordUpdateErrorKey({ code: "reauthentication_needed" })).toBe("reauthNeeded");
    expect(passwordUpdateErrorKey({ status: 429, message: "rate limit" })).toBe("tooManyAttempts");
    expect(passwordUpdateErrorKey({ message: "Failed to fetch" })).toBe("network");
    expect(passwordUpdateErrorKey({ message: "something else" })).toBe("generic");
  });

  it("every message exists in RU and EN", () => {
    const keys = ["blank", "tooShort", "tooLong", "wrongCurrent", "samePassword", "reauthNeeded", "tooManyAttempts", "network", "generic"] as const;
    for (const lang of ["ru", "en"] as const) for (const k of keys) expect(getDictionary(lang).account.password.errors[k]).toBeTruthy();
  });
});

describe("sign-in answers (auth plan PR C)", () => {
  it("wrong password and unknown e-mail give one and the same key", async () => {
    const { signInErrorKey } = await import("./password");
    expect(signInErrorKey({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 })).toBe("invalidCredentials");
    expect(signInErrorKey({ message: "Invalid login credentials", status: 400 })).toBe("invalidCredentials");
    expect(signInErrorKey({ code: "email_not_confirmed", message: "Email not confirmed", status: 400 })).toBe("emailNotConfirmed");
    expect(signInErrorKey({ status: 429, message: "Request rate limit reached" })).toBe("tooManyAttempts");
    expect(signInErrorKey({ message: "Failed to fetch" })).toBe("networkError");
    expect(signInErrorKey({ status: 503, message: "upstream" })).toBe("authUnavailable");
  });

  it("an already registered e-mail on sign-up is not an error", async () => {
    const { isAlreadyRegistered } = await import("./password");
    expect(isAlreadyRegistered({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegistered({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegistered({ code: "weak_password" })).toBe(false);
  });

  it("every login message exists in RU and EN", () => {
    const keys = ["invalidCredentials", "emailNotConfirmed", "passwordBlank", "passwordTooShort", "passwordTooLong", "samePassword", "tooManyAttempts"] as const;
    for (const lang of ["ru", "en"] as const) for (const k of keys) expect(getDictionary(lang).auth.errors[k]).toBeTruthy();
  });
});
