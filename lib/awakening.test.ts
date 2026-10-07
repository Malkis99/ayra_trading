import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  migrateState,
} from "./game";
import {
  SKIN_TONES,
  HAIRSTYLES,
  HAIR_COLORS,
  OUTFITS,
  DEFAULT_AVATAR_APPEARANCE,
  validateAvatarAppearance,
} from "./avatar";
import {
  QUESTIONS_CATALOG,
  TRADING_GOAL_OPTIONS,
  JOIN_REASON_OPTIONS,
  OBSTACLES_OPTIONS,
  getFilteredOptions,
  generateProgram,
  getQuestionsForStep,
} from "./awakening";
import { isValidLatinNickname } from "./stats";
import { ru } from "./i18n/dictionaries/ru";
import { en } from "./i18n/dictionaries/en";

describe("T5a Character Awakening & Onboarding Logic", () => {
  it("1. Mandatory fields validation", () => {
    // Nickname latin check
    expect(isValidLatinNickname("TraderOne")).toBe(true);
    expect(isValidLatinNickname("Trader_123")).toBe(true);
    expect(isValidLatinNickname("Иван")).toBe(false);
    expect(isValidLatinNickname("ab")).toBe(false);

    // Mandatory questions in catalog exist and are marked mandatory
    const mandatoryQuestions = QUESTIONS_CATALOG.filter((q) => q.mandatory);
    const mandatoryIds = mandatoryQuestions.map((q) => q.id);

    expect(mandatoryIds).toContain("nickname");
    expect(mandatoryIds).toContain("language_timezone");
    expect(mandatoryIds).toContain("ageRange");
    expect(mandatoryIds).toContain("experience");
    expect(mandatoryIds).toContain("markets");
    expect(mandatoryIds).toContain("mainProblem");
  });

  it("2. Every question in QUESTIONS_CATALOG has a non-empty title in RU and EN dictionaries", () => {
    QUESTIONS_CATALOG.forEach((q) => {
      const ruTitle = (ru.awakening.q as any)[q.id]?.title;
      const enTitle = (en.awakening.q as any)[q.id]?.title;

      expect(ruTitle, `Missing RU title for question ID: ${q.id}`).toBeDefined();
      expect(typeof ruTitle).toBe("string");
      expect(ruTitle.trim().length).toBeGreaterThan(0);

      expect(enTitle, `Missing EN title for question ID: ${q.id}`).toBeDefined();
      expect(typeof enTitle).toBe("string");
      expect(enTitle.trim().length).toBeGreaterThan(0);
    });
  });

  it("3. Confirms 'whyThisIsNeeded' and 'visibleOnlyToYou' are completely removed from dictionaries", () => {
    expect((ru.awakening as any).whyThisIsNeeded).toBeUndefined();
    expect((ru.awakening as any).visibleOnlyToYou).toBeUndefined();

    expect((en.awakening as any).whyThisIsNeeded).toBeUndefined();
    expect((en.awakening as any).visibleOnlyToYou).toBeUndefined();

    const ruStr = JSON.stringify(ru.awakening);
    const enStr = JSON.stringify(en.awakening);

    expect(ruStr).not.toContain("Зачем это нужно");
    expect(ruStr).not.toContain("Видно только вам");

    expect(enStr).not.toContain("Why this is needed");
    expect(enStr).not.toContain("Visible only to you");
  });

  it("4. Draft save & restore in onboarding state", () => {
    const rawSavedState = {
      ...INITIAL_GAME_STATE,
      onboarding: {
        status: "inProgress",
        step: 2,
        subStep: 3,
        answers: {
          nickname: "Alex_Trader",
          ageRange: "18-24",
          experience: "1_2_years",
          markets: ["forex", "crypto"],
        },
        startedAt: "2026-10-05T10:00:00Z",
      },
    };

    const migrated = migrateState(rawSavedState);
    expect(migrated.onboarding.status).toBe("inProgress");
    expect(migrated.onboarding.step).toBe(2);
    expect(migrated.onboarding.subStep).toBe(3);
    expect(migrated.onboarding.answers.nickname).toBe("Alex_Trader");
    expect(migrated.onboarding.answers.markets).toEqual(["forex", "crypto"]);
  });

  it("5. Legacy profile migration without forced redirect", () => {
    // Existing profile without onboarding key
    const rawLegacyProfile = {
      name: "OldTrader",
      level: 3,
      xp: 120,
    };

    const migrated = migrateState(rawLegacyProfile);
    expect(migrated.onboarding.status).toBe("legacy");
    expect(migrated.onboarding.legacyDismissed).toBe(false);
    expect(migrated.profile.appearance).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });

  it("6. Clean device state initializes onboarding.status as 'none'", () => {
    const cleanState = migrateState(null);
    expect(cleanState.onboarding.status).toBe("none");
    expect(cleanState.onboarding.step).toBe(1);
    expect(cleanState.onboarding.subStep).toBe(0);
  });

  it("7. Sets minorMode = true for age 16-17", () => {
    const rawMinorState = {
      name: "YoungTrader",
      onboarding: {
        status: "done",
        step: 5,
        subStep: 0,
        answers: {
          ageRange: "16-17",
        },
      },
    };

    const migrated = migrateState(rawMinorState);
    expect(migrated.profile.minorMode).toBe(true);
  });

  it("8. minorSafe option catalog filtering for 16-17 year olds", () => {
    const tradingGoalsMinor = getFilteredOptions(TRADING_GOAL_OPTIONS, true);
    const tradingGoalsAdult = getFilteredOptions(TRADING_GOAL_OPTIONS, false);

    expect(tradingGoalsAdult.some((o) => o.id === "stable_income")).toBe(true);
    expect(tradingGoalsMinor.some((o) => o.id === "stable_income")).toBe(false);
    expect(tradingGoalsMinor.some((o) => o.id === "financial_independence")).toBe(false);
    expect(tradingGoalsMinor.every((o) => o.minorSafe)).toBe(true);

    const joinReasonsMinor = getFilteredOptions(JOIN_REASON_OPTIONS, true);
    expect(joinReasonsMinor.some((o) => o.id === "increase_capital")).toBe(false);
    expect(joinReasonsMinor.every((o) => o.minorSafe)).toBe(true);

    const obstaclesMinor = getFilteredOptions(OBSTACLES_OPTIONS, true);
    expect(obstaclesMinor.some((o) => o.id === "small_deposit")).toBe(false);
    expect(obstaclesMinor.every((o) => o.minorSafe)).toBe(true);
  });

  it("9. Appearance preset catalog and validation", () => {
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(6);
    expect(HAIRSTYLES.length).toBeGreaterThanOrEqual(6);
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(OUTFITS.length).toBeGreaterThanOrEqual(4);

    const valid = validateAvatarAppearance({
      skinTone: "skin_fair",
      hairstyle: "hair_bob",
      hairColor: "hair_silver",
      outfit: "outfit_violet",
    });
    expect(valid.skinTone).toBe("skin_fair");
    expect(valid.hairstyle).toBe("hair_bob");

    const invalid = validateAvatarAppearance({
      skinTone: "invalid_skin",
      hairstyle: "non_existent_hair",
    });
    expect(invalid.skinTone).toBe(DEFAULT_AVATAR_APPEARANCE.skinTone);
    expect(invalid.hairstyle).toBe(DEFAULT_AVATAR_APPEARANCE.hairstyle);
  });

  it("10. Walking all sub-questions of each step verifies valid title for every question", () => {
    [1, 2, 3, 4].forEach((step) => {
      const questions = getQuestionsForStep(step);
      expect(questions.length).toBeGreaterThan(0);
      questions.forEach((q) => {
        const titleRu = (ru.awakening.q as any)[q.id]?.title;
        expect(titleRu).toBeTruthy();
      });
    });
  });

  it("11. Stub generateProgram returns null in T5a", () => {
    expect(generateProgram({})).toBeNull();
  });
});
