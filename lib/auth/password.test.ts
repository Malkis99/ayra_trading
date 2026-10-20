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
