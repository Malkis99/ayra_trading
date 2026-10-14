import { describe, it, expect } from "vitest";
import {
  PROFILE_ACHIEVEMENTS,
  achievementProgress,
  recentAchievements,
  filterWardrobe,
  itemState,
  nicknameProblem,
  sameAppearance,
  timeZoneOptions,
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

  it("appearance comparison and time zones", () => {
    expect(sameAppearance(DEFAULT_AVATAR_APPEARANCE, { ...DEFAULT_AVATAR_APPEARANCE })).toBe(true);
    expect(sameAppearance(DEFAULT_AVATAR_APPEARANCE, { ...DEFAULT_AVATAR_APPEARANCE, outfit: "x" })).toBe(false);
    const zones = timeZoneOptions("Mars/Base");
    expect(zones[0]).toBe("Mars/Base");
    expect(zones).toContain("UTC");
  });
});
