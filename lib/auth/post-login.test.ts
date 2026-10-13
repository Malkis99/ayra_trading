import { describe, it, expect } from "vitest";
import { postLoginRouterUrl, safeNextAfterLogin } from "./post-login";
import { hasCloudNickname } from "./routing";

describe("post-login router URL", () => {
  it("always points to /auth/continue and carries a safe next", () => {
    expect(postLoginRouterUrl(null)).toBe("/auth/continue");
    expect(postLoginRouterUrl("/")).toBe("/auth/continue");
    expect(postLoginRouterUrl("/journal?tab=plan")).toBe("/auth/continue?next=%2Fjournal%3Ftab%3Dplan");
  });

  it("never uses an external URL or an auth-flow page as next", () => {
    expect(safeNextAfterLogin("https://evil.example")).toBe("/");
    expect(safeNextAfterLogin("//evil.example")).toBe("/");
    expect(safeNextAfterLogin("/login?next=/x")).toBe("/");
    expect(safeNextAfterLogin("/auth/callback?code=1")).toBe("/");
    expect(safeNextAfterLogin("/auth/continue")).toBe("/");
    expect(safeNextAfterLogin("/logout")).toBe("/");
  });

  it("treats only a real cloud nickname as a finished onboarding", () => {
    expect(hasCloudNickname(null)).toBe(false);
    expect(hasCloudNickname({ nickname: null })).toBe(false);
    expect(hasCloudNickname({ nickname: "  " })).toBe(false);
    expect(hasCloudNickname({ nickname: "Trader_1" })).toBe(true);
  });
});
