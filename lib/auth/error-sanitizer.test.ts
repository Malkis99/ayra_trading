import { describe, it, expect } from "vitest";
import { sanitizeErrorMessage, mapSupabaseError } from "./error-sanitizer";

describe("error-sanitizer", () => {
  it("sanitizes email addresses, tokens, keys and query params", () => {
    const raw = "Error for user alex@example.com with token=eyJhbGciOiJIUzI1NiJ9 and key=sb_secret?foo=bar&email=test@test.com";
    const clean = sanitizeErrorMessage(raw);
    expect(clean).not.toContain("alex@example.com");
    expect(clean).not.toContain("test@test.com");
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(clean).not.toContain("sb_secret");
    expect(clean).not.toContain("foo=bar");
  });

  it("maps rate limit errors correctly", () => {
    const res = mapSupabaseError({ status: 429, message: "over_email_send_rate_limit" });
    expect(res.errorKey).toBe("rateLimitExceeded");
  });

  it("maps network errors correctly", () => {
    const res = mapSupabaseError({ name: "FetchError", message: "Failed to fetch" });
    expect(res.errorKey).toBe("networkError");
  });

  it("maps invalid or expired code errors correctly", () => {
    const res = mapSupabaseError({ status: 400, message: "Token has expired or is invalid" });
    expect(res.errorKey).toBe("invalidOrExpiredCode");
  });

  it("maps server error to authUnavailable", () => {
    const res = mapSupabaseError({ status: 503, message: "Service Unavailable" });
    expect(res.errorKey).toBe("authUnavailable");
  });
});
