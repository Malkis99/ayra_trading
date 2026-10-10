import { describe, it, expect } from "vitest";
import { cleanSupabaseUrl, cleanApiKey } from "../supabase/config";
import { buildSafeSiteUrlRedirect, sanitizeRedirectUrl } from "./redirect-whitelist";
import { sanitizeErrorMessage, mapSupabaseError } from "./error-sanitizer";

describe("T7a.1 Config & URL Truncation Unit Tests", () => {
  it("truncates extra path like /rest/v1 and trailing slashes from Supabase URL", () => {
    const rawWithRest = "https://xyz.supabase.co/rest/v1/";
    const res1 = cleanSupabaseUrl(rawWithRest);
    expect(res1.url).toBe("https://xyz.supabase.co");
    expect(res1.truncatedReason).toContain("Truncated path");

    const rawWithSlash = "https://abc.supabase.co/";
    const res2 = cleanSupabaseUrl(rawWithSlash);
    expect(res2.url).toBe("https://abc.supabase.co");
    expect(res2.truncatedReason).toContain("Trimmed trailing slash");

    const rawWithQuotes = ' "https://def.supabase.co" ';
    const res3 = cleanSupabaseUrl(rawWithQuotes);
    expect(res3.url).toBe("https://def.supabase.co");
  });

  it("trims quotes and whitespace from API keys", () => {
    expect(cleanApiKey(' "sb_anon_key_123" ')).toBe("sb_anon_key_123");
    expect(cleanApiKey(" 'sb_anon_key_456' ")).toBe("sb_anon_key_456");
  });
});

describe("T7a.1 Redirect Whitelist & Site URL Protection", () => {
  it("allows valid relative internal next paths", () => {
    expect(sanitizeRedirectUrl("/journal")).toBe("/journal");
    expect(sanitizeRedirectUrl("/profile?tab=stats")).toBe("/profile?tab=stats");
  });

  it("blocks open redirect and protocol relative URLs", () => {
    expect(sanitizeRedirectUrl("//evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("https://evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
  });

  it("builds safe site URL redirect link without secret parameters", () => {
    const mainSite = "https://ayratrading.com";

    // Path only forward, secret tokens and hash stripped
    const link1 = buildSafeSiteUrlRedirect(mainSite, "/journal?code=123456&access_token=secret_jwt#section");
    expect(link1).toBe("https://ayratrading.com/login?next=%2Fjournal");

    // Malicious or empty next URL
    const link2 = buildSafeSiteUrlRedirect(mainSite, "https://hacker.com");
    expect(link2).toBe("https://ayratrading.com/login");
  });
});

describe("T7a.1 Error Sanitization & Mapping", () => {
  it("redacts email addresses, bearer tokens, apikeys, and query parameters", () => {
    const raw = "Failed request for alex.dev@company.org with token=eyJhbGciOiJIUzI1NiJ9 and apikey=secret_key?code=123456";
    const clean = sanitizeErrorMessage(raw);

    expect(clean).not.toContain("alex.dev@company.org");
    expect(clean).toContain("***@***");
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(clean).not.toContain("secret_key");
    expect(clean).not.toContain("code=123456");
  });

  it("maps Supabase errors to concise user-facing error keys", () => {
    expect(mapSupabaseError({ status: 429 }).errorKey).toBe("rateLimitExceeded");
    expect(mapSupabaseError({ name: "FetchError" }).errorKey).toBe("networkError");
    expect(mapSupabaseError({ status: 400, message: "Invalid code" }).errorKey).toBe("invalidOrExpiredCode");
    expect(mapSupabaseError({ status: 500 }).errorKey).toBe("authUnavailable");
  });
});
