import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, migrateState, updateProfileInfo } from "./game";

describe("profile edits in the game state", () => {
  it("bio and nickname are saved; optional details survive a reload (migrateState)", () => {
    const s1 = { ...updateProfileInfo(INITIAL_GAME_STATE, "Nova_Trader", "Учусь торговать по плану"), profileDetails: { country: "GE", visibility: "hidden" as const, nicknameChangedAt: "2026-10-14T10:00:00Z" } };
    expect(s1.name).toBe("Nova_Trader");
    expect(s1.bio).toBe("Учусь торговать по плану");
    const reloaded = migrateState(JSON.parse(JSON.stringify(s1)));
    expect(reloaded.name).toBe("Nova_Trader");
    expect(reloaded.bio).toBe("Учусь торговать по плану");
    expect(reloaded.profileDetails).toEqual({ country: "GE", visibility: "hidden", nicknameChangedAt: "2026-10-14T10:00:00Z" });
  });

  it("the stage background key is kept in the appearance", () => {
    const st = migrateState({ ...INITIAL_GAME_STATE, profile: { ...INITIAL_GAME_STATE.profile, appearance: { ...INITIAL_GAME_STATE.profile.appearance, stageBackground: "deep_space" } } });
    expect(st.profile.appearance.stageBackground).toBe("deep_space");
    const bad = migrateState({ ...INITIAL_GAME_STATE, profile: { ...INITIAL_GAME_STATE.profile, appearance: { ...INITIAL_GAME_STATE.profile.appearance, stageBackground: "nope" } } });
    expect(bad.profile.appearance.stageBackground).toBeUndefined();
  });
});
