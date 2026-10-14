import { describe, it, expect } from "vitest";
import {
  PROFILE_ACHIEVEMENTS,
  achievementProgress,
  recentAchievements,
  filterWardrobe,
  itemState,
  nicknameProblem,
  sameAppearance,
  nicknameDaysLeft,
  normalizeSocial,
  countryOptions,
  wardrobeSlots,
} from "./profile";
import { ITEMS } from "./items";
import { DEFAULT_AVATAR_APPEARANCE } from "./avatar";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";

describe("profile helpers", () => {
  it("every achievement has a title and a hint in both languages", () => {
    for (const dict of [ru, en]) {
      const a = dict.profile.achievements as Record<string, string>;
      for (const id of PROFILE_ACHIEVEMENTS) {
        expect(a[id], id).toBeTruthy();
        expect(a[`${id}Desc`], `${id}Desc`).toBeTruthy();
      }
    }
  });

  it("recent achievements come from the chronicle first, newest first", () => {
    const state = {
      achievements: { firstQuest: true, firstTrade: true, stylist: true },
      chronicle: [
        { type: "achievementUnlocked" as const, achievementId: "stylist" },
        { type: "levelUp" as const, level: 2 },
        { type: "achievementUnlocked" as const, achievementId: "firstTrade" },
      ],
    };
    expect(recentAchievements(state, 3)).toEqual(["stylist", "firstTrade", "firstQuest"]);
    expect(achievementProgress(state)).toEqual({ done: 3, total: PROFILE_ACHIEVEMENTS.length });
  });

  it("wardrobe filter: by slot and state, equipped first", () => {
    const state = { equipment: { Верх: 1 } as Record<string, number>, level: 1 };
    const tops = filterWardrobe(state, "Верх", "all");
    expect(tops[0].id).toBe(1);
    expect(tops.every((t) => t.slot === "Верх")).toBe(true);
    expect(tops[tops.length - 1].reqLevel).toBeGreaterThan(1);
    expect(filterWardrobe(state, "all", "locked").every((it) => itemState(it, state) === "locked")).toBe(true);
    expect(filterWardrobe(state, "all", "equipped").map((i) => i.id)).toEqual([1]);
    expect(wardrobeSlots().length).toBeGreaterThan(0);
    expect(wardrobeSlots().every((s) => ITEMS.some((i) => i.slot === s))).toBe(true);
  });

  it("nickname rules: Latin only, 3–24 characters", () => {
    expect(nicknameProblem("Nova_Trader")).toBeNull();
    expect(nicknameProblem("Трейдер")).toBe("latin");
    expect(nicknameProblem("ab")).toBe("length");
    expect(nicknameProblem("a".repeat(25))).toBe("length");
  });

  it("appearance comparison", () => {
    expect(sameAppearance(DEFAULT_AVATAR_APPEARANCE, { ...DEFAULT_AVATAR_APPEARANCE })).toBe(true);
    expect(sameAppearance(DEFAULT_AVATAR_APPEARANCE, { ...DEFAULT_AVATAR_APPEARANCE, outfit: "x" })).toBe(false);
    // the stage background is not part of the figure
    expect(sameAppearance(DEFAULT_AVATAR_APPEARANCE, { ...DEFAULT_AVATAR_APPEARANCE, stageBackground: "graphite" })).toBe(true);
  });

  it("nickname can be changed once per 14 days; the first change after onboarding is free", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(nicknameDaysLeft(null, now)).toBe(0);
    expect(nicknameDaysLeft("2026-10-19T12:00:00Z", now)).toBe(13);
    expect(nicknameDaysLeft("2026-10-06T12:00:00Z", now)).toBe(0);
    expect(nicknameDaysLeft("2026-10-06T13:00:00Z", now)).toBe(1);
  });

  it("social links: handles and profile URLs are normalised, wrong ones rejected", () => {
    expect(normalizeSocial("telegram", "@ayra_trader")).toBe("@ayra_trader");
    expect(normalizeSocial("telegram", "https://t.me/ayra_trader")).toBe("@ayra_trader");
    expect(normalizeSocial("telegram", "ab")).toBeNull();
    expect(normalizeSocial("x", "x.com/ayra")).toBe("@ayra");
    expect(normalizeSocial("x", "https://twitter.com/ayra")).toBe("@ayra");
    expect(normalizeSocial("x", "https://instagram.com/ayra")).toBeNull();
    expect(normalizeSocial("instagram", "ayra.trading")).toBe("@ayra.trading");
    expect(normalizeSocial("youtube", "https://www.youtube.com/@AyraTrading")).toBe("@AyraTrading");
    expect(normalizeSocial("youtube", "https://youtube.com/channel/UC123")).toBe("https://youtube.com/channel/UC123");
    expect(normalizeSocial("youtube", "https://vimeo.com/x")).toBeNull();
    expect(normalizeSocial("x", "")).toBe("");
  });

  it("countries have localised names", () => {
    const ru = countryOptions("ru");
    expect(ru.find((c) => c.value === "GE")?.label).toBe("Грузия");
    expect(ru.length).toBeGreaterThan(240);
  });
});
