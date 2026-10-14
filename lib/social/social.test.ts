import { describe, it, expect, beforeEach } from "vitest";
import { LocalSocialRepository, canSeeSocialCounts, formatSocialCount, localProfileId } from "./repository";

describe("social model", () => {
  beforeEach(() => localStorage.clear());

  it("starts with zeros (no invented numbers)", async () => {
    const repo = new LocalSocialRepository("test_social");
    expect(await repo.getCounts("me")).toEqual({ followers: 0, following: 0, likes: 0 });
    expect(await repo.listFollowers("me")).toEqual([]);
  });

  it("cannot follow or like yourself; duplicates are refused; counts follow real events", async () => {
    const repo = new LocalSocialRepository("test_social");
    expect(await repo.follow("me", "me")).toEqual({ ok: false, error: "self" });
    expect(await repo.likeProfile("me", "me")).toEqual({ ok: false, error: "self" });
    expect(await repo.follow("a", "me")).toEqual({ ok: true });
    expect(await repo.follow("a", "me")).toEqual({ ok: false, error: "duplicate" });
    expect(await repo.follow("me", "b")).toEqual({ ok: true });
    expect(await repo.likeProfile("a", "me")).toEqual({ ok: true });
    expect(await repo.getCounts("me")).toEqual({ followers: 1, following: 1, likes: 1 });
    await repo.unfollow("a", "me");
    await repo.unlikeProfile("a", "me");
    expect(await repo.getCounts("me")).toEqual({ followers: 0, following: 1, likes: 0 });
  });

  it("hidden profiles hide counters from others, never from the owner", () => {
    expect(canSeeSocialCounts("me", "me", "hidden")).toBe(true);
    expect(canSeeSocialCounts("other", "me", "hidden")).toBe(false);
    expect(canSeeSocialCounts(null, "me", "public")).toBe(true);
    expect(canSeeSocialCounts("other", "me", undefined)).toBe(true);
    expect(localProfileId(null)).toBe("local");
  });

  it("compact numbers", () => {
    expect(formatSocialCount(0, "ru")).toBe("0");
    expect(formatSocialCount(1085, "ru").replace(/\s/g, " ")).toBe("1 085");
    expect(formatSocialCount(24100, "ru").replace(/\s/g, " ")).toBe("24,1 тыс.");
    expect(formatSocialCount(24100, "en")).toBe("24.1K");
  });
});
