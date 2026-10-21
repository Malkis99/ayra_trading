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

  it("tells the three 429 cases apart: code asked too soon, e-mail limit, too many requests (auth plan PR A)", () => {
    const soon = mapSupabaseError({ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 42 seconds." });
    expect(soon.errorKey).toBe("resendTooSoon");
    expect(soon.retryAfterSeconds).toBe(42);
    expect(mapSupabaseError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }).errorKey).toBe("rateLimitExceeded");
    expect(mapSupabaseError({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }).errorKey).toBe("tooManyAttempts");
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
