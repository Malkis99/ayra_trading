import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import LoginPage from "@/app/login/page";
import { GET as handleCallbackGet } from "@/app/auth/callback/route";
import { setMockState } from "@/lib/auth/mock-auth";
import { NextRequest } from "next/server";
import { AppProvider } from "@/lib/context";
import { AuthProvider } from "@/lib/auth/auth-context";
import { GameProvider } from "@/lib/game-context";
import { JournalProvider } from "@/lib/journal/context";

// Track router replace calls
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

describe("T7a.3 Multi-Tab Login & Callback Verification", () => {
  const origEnv = process.env.AYRA_E2E_AUTH_MOCK;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    process.env.AYRA_E2E_AUTH_MOCK = "1";
  });

  afterEach(() => {
    process.env.AYRA_E2E_AUTH_MOCK = origEnv;
  });

  it("Tab A on /login shows multi-tab card when user logged in via another tab, without auto-redirecting", async () => {
    // Set logged-in state in mock storage
    setMockState(
      { id: "mock-u1", email: "trader@example.com", created_at: new Date().toISOString() },
      {
        id: "mock-u1",
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
              <LoginPage />
            </JournalProvider>
          </GameProvider>
        </AuthProvider>
      </AppProvider>
    );

    // Multi-tab card is rendered instead of auto-redirecting
    await waitFor(() => {
      expect(screen.getByText(/Вход выполнен в другой вкладке/i)).not.toBeNull();
    });

    expect(replaceMock).not.toHaveBeenCalled();

    // Click "Продолжить здесь"
    const continueBtn = screen.getByText(/Продолжить здесь/i);
    fireEvent.click(continueBtn);

    // Now routing executes
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalled();
    });
  });

  it("/auth/callback handles code exchange cleanly", async () => {
    const req = new NextRequest("http://localhost:3000/auth/callback?code=mock-code");
    const response = await handleCallbackGet(req);

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
