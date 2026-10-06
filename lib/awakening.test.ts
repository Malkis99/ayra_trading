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
  INITIAL_ONBOARDING_STATE,
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

  it("2. Draft save & restore in onboarding state", () => {
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

  it("3. Legacy profile migration without forced redirect", () => {
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

  it("4. Clean device state initializes onboarding.status as 'none'", () => {
    const cleanState = migrateState(null);
    expect(cleanState.onboarding.status).toBe("none");
    expect(cleanState.onboarding.step).toBe(1);
    expect(cleanState.onboarding.subStep).toBe(0);
  });

  it("5. Sets minorMode = true for age 16-17", () => {
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

  it("6. minorSafe option catalog filtering for 16-17 year olds", () => {
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

  it("7. Appearance preset catalog and validation", () => {
    // Check preset catalogs are not empty
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(6);
    expect(HAIRSTYLES.length).toBeGreaterThanOrEqual(6);
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(OUTFITS.length).toBeGreaterThanOrEqual(4);

    // Validate valid appearance
    const valid = validateAvatarAppearance({
      skinTone: "skin_fair",
      hairstyle: "hair_bob",
      hairColor: "hair_silver",
      outfit: "outfit_violet",
    });
    expect(valid.skinTone).toBe("skin_fair");
    expect(valid.hairstyle).toBe("hair_bob");

    // Validate invalid appearance falls back to default
    const invalid = validateAvatarAppearance({
      skinTone: "invalid_skin",
      hairstyle: "non_existent_hair",
    });
    expect(invalid.skinTone).toBe(DEFAULT_AVATAR_APPEARANCE.skinTone);
    expect(invalid.hairstyle).toBe(DEFAULT_AVATAR_APPEARANCE.hairstyle);
  });

  it("8. GameState contains pure IDs/keys and no translated strings", () => {
    const state = migrateState({
      onboarding: {
        status: "inProgress",
        step: 3,
        subStep: 1,
        answers: {
          experience: "1_2_years",
          markets: ["forex", "crypto"],
          mainProblem: "discipline",
        },
      },
    });

    expect(state.onboarding.answers.experience).toBe("1_2_years");
    expect(state.onboarding.answers.markets).toEqual(["forex", "crypto"]);
    expect(state.onboarding.answers.mainProblem).toBe("discipline");
  });

  it("9. Stub generateProgram returns null in T5a", () => {
    expect(generateProgram({})).toBeNull();
  });

  it("10. i18n dictionaries contain matching keys for avatar & awakening", () => {
    expect(ru.avatar).toBeDefined();
    expect(en.avatar).toBeDefined();
    expect(Object.keys(ru.avatar).sort()).toEqual(Object.keys(en.avatar).sort());

    expect(ru.awakening).toBeDefined();
    expect(en.awakening).toBeDefined();
    expect(Object.keys(ru.awakening).sort()).toEqual(Object.keys(en.awakening).sort());
  });
});
