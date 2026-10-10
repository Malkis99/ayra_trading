import { describe, it, expect } from "vitest";
import { sanitizeRedirectUrl, buildSafeSiteUrlRedirect } from "./redirect-whitelist";

describe("redirect-whitelist", () => {
  it("sanitizes relative redirect paths", () => {
    expect(sanitizeRedirectUrl("/journal")).toBe("/journal");
    expect(sanitizeRedirectUrl("//evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("https://evil.com")).toBe("/");
  });

  it("builds safe site url redirect stripping query params and secret tokens", () => {
    const siteUrl = "https://ayratrading.com";

    // Normal internal route with query params
    const res1 = buildSafeSiteUrlRedirect(siteUrl, "/journal?tab=trades&token=secret#top");
    expect(res1).toBe("https://ayratrading.com/login?next=%2Fjournal");
    expect(res1).not.toContain("token");
    expect(res1).not.toContain("tab");
    expect(res1).not.toContain("#top");

    // External or malicious next parameter
    const res2 = buildSafeSiteUrlRedirect(siteUrl, "https://evil.com/hack");
    expect(res2).toBe("https://ayratrading.com/login");

    // Empty next param
    const res3 = buildSafeSiteUrlRedirect(siteUrl, null);
    expect(res3).toBe("https://ayratrading.com/login");
  });
});
