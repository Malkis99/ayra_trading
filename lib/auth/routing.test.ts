import { describe, it, expect, vi } from "vitest";
import { resolvePostLoginRoute } from "./routing";

describe("resolvePostLoginRoute (T7a.3)", () => {
  const mockUser = { id: "u1", email: "trader@example.com" };

  it("routes to Home when cloud profile already has a nickname", async () => {
    const res = await resolvePostLoginRoute({
      user: mockUser,
      profile: {
        id: "u1",
        nickname: "CloudTrader",
        locale: "ru",
        timezone: "UTC",
        age_group: "25-34",
        minor_mode: false,
        consent_at: null,
        consent_version: null,
        created_at: "",
        updated_at: "",
      },
      rawNextParam: "/journal",
    });

    expect(res.destination).toBe("/journal");
    expect(res.source).toBe("cloud");
  });

  it("transfers valid guest nickname from completed onboarding when available", async () => {
    const checkNickMock = vi.fn().mockResolvedValue(true);
    const saveNickMock = vi.fn().mockResolvedValue({ success: true });
    const updateProfileMock = vi.fn().mockResolvedValue(true);

    const guestState = {
      name: "GuestTrader",
      onboarding: {
        status: "done",
        answers: {
          nickname: "GuestTrader",
          language: "ru",
          timezone: "Europe/Moscow",
          ageRange: "18-24",
        },
      },
    };

    const res = await resolvePostLoginRoute({
      user: mockUser,
      profile: {
        id: "u1",
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: null,
        consent_version: null,
        created_at: "",
        updated_at: "",
      },
      guestState,
      checkNicknameAvailable: checkNickMock,
      saveNickname: saveNickMock,
      updateProfile: updateProfileMock,
    });

    expect(res.destination).toBe("/");
    expect(res.source).toBe("onboarding_answers");
    expect(saveNickMock).toHaveBeenCalledWith("GuestTrader");
    expect(updateProfileMock).toHaveBeenCalledWith({
      locale: "ru",
      timezone: "Europe/Moscow",
      age_group: "18-24",
    });
  });

  it("routes to conflict screen when candidate nickname is taken", async () => {
    const checkNickMock = vi.fn().mockResolvedValue(false); // taken
    const saveNickMock = vi.fn();

    const guestState = {
      name: "TakenTrader",
      onboarding: {
        status: "done",
        answers: { nickname: "TakenTrader" },
      },
    };

    const res = await resolvePostLoginRoute({
      user: mockUser,
      profile: {
        id: "u1",
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: null,
        consent_version: null,
        created_at: "",
        updated_at: "",
      },
      guestState,
      checkNicknameAvailable: checkNickMock,
      saveNickname: saveNickMock,
    });

    expect(res.destination).toBe("/awakening?mode=conflict");
    expect(res.source).toBe("conflict");
    expect(res.nicknameConflict).toBe(true);
    expect(saveNickMock).not.toHaveBeenCalled();
  });

  it("routes to /awakening when guest onboarding is in progress (not completed)", async () => {
    const saveNickMock = vi.fn();

    const guestState = {
      name: "IncompleteTrader",
      onboarding: {
        status: "inProgress",
        step: 2,
        subStep: 1,
        answers: { nickname: "IncompleteTrader" },
      },
    };

    const res = await resolvePostLoginRoute({
      user: mockUser,
      profile: {
        id: "u1",
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: null,
        consent_version: null,
        created_at: "",
        updated_at: "",
      },
      guestState,
      saveNickname: saveNickMock,
    });

    expect(res.destination).toBe("/awakening");
    expect(res.source).toBe("guest_in_progress");
    expect(saveNickMock).not.toHaveBeenCalled();
  });
});
