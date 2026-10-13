import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setMockState } from "@/lib/auth/mock-auth";
import { AppProvider } from "@/lib/context";
import { AuthProvider, useAuth } from "@/lib/auth/auth-context";
import { GameProvider, useGame } from "@/lib/game-context";
import { JournalProvider } from "@/lib/journal/context";
import { AppStorage } from "@/lib/storage";

// Track router replace calls
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
  usePathname: () => "/auth/callback",
  useSearchParams: () => new URLSearchParams(),
}));

// Display component to inspect rendered user name/level
function Inspector() {
  const { user, profile, activeSpaceId, isLoading } = useAuth();
  const game = useGame();

  return (
    <div>
      <div data-testid="is-loading">{String(isLoading)}</div>
      <div data-testid="active-space">{activeSpaceId}</div>
      <div data-testid="user-id">{user ? user.id : "none"}</div>
      <div data-testid="character-name">{game?.gameState?.name || "none"}</div>
      <div data-testid="character-level">{game?.gameState?.level || 0}</div>
    </div>
  );
}

describe("T7a-B3 Bug Reproduction: Tab B callback with guest localStorage", () => {
  const origEnv = process.env.AYRA_E2E_AUTH_MOCK;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    process.env.AYRA_E2E_AUTH_MOCK = "1";
  });

  afterEach(() => {
    process.env.AYRA_E2E_AUTH_MOCK = origEnv;
  });

  it("BUG PROOF: Opening Tab B with existing guest profile in localStorage and ready session shows bug in old code", async () => {
    // 1. Setup existing local guest data in localStorage
    AppStorage.setItem("ayra_demo_v1", JSON.stringify({
      name: "GuestLevel5",
      level: 5,
      xp: 250,
      coins: 100,
      onboarding: { status: "none", step: 0, answers: {} }
    }));

    // 2. Set mock session in storage (represents magic link callback result)
    setMockState(
      { id: "mock-user-tab-b", email: "newuser_b@example.com", created_at: new Date().toISOString() },
      {
        id: "mock-user-tab-b",
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: new Date().toISOString(),
        consent_version: "1.0-draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );

    render(
      <AppProvider initialLang="ru">
        <AuthProvider>
          <GameProvider>
            <JournalProvider>
              <Inspector />
            </JournalProvider>
          </GameProvider>
        </AuthProvider>
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("mock-user-tab-b");
    });

    // In old code, active space was account:mock-user-tab-b
    expect(screen.getByTestId("active-space").textContent).toBe("account:mock-user-tab-b");
  });
});
