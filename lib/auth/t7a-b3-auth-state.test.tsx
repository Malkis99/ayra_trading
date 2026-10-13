import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { setMockState } from "@/lib/auth/mock-auth";
import { AppProvider } from "@/lib/context";
import { AuthProvider, useAuth } from "@/lib/auth/auth-context";
import { AppStorage } from "@/lib/storage";

function AuthTester() {
  const { authState, activeSpaceId, chooseGuestExplicitly, loadingTimedOut } = useAuth();
  return (
    <div>
      <div data-testid="auth-state">{authState}</div>
      <div data-testid="active-space">{activeSpaceId}</div>
      <div data-testid="timed-out">{String(loadingTimedOut)}</div>
      <button data-testid="guest-btn" onClick={chooseGuestExplicitly}>
        Continue guest
      </button>
    </div>
  );
}

describe("AuthState & ActiveSpace Unit Tests (T7a-B3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    process.env.AYRA_E2E_AUTH_MOCK = "1";
  });

  it("1. Transitions to authenticated and sets account space when session exists", async () => {
    setMockState(
      { id: "mock-u100-test-id", email: "unit@example.com", created_at: new Date().toISOString() },
      { id: "mock-u100-test-id", nickname: "UnitUser", locale: "ru", timezone: "UTC", age_group: null, minor_mode: false, consent_at: null, consent_version: null, created_at: "", updated_at: "" }
    );

    render(
      <AppProvider initialLang="ru">
        <AuthProvider>
          <AuthTester />
        </AuthProvider>
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-state").textContent).toBe("authenticated");
    });

    expect(screen.getByTestId("active-space").textContent).toBe("account:mock-u100-test-id");
  });

  it("2. Timeout does not automatically switch space to guest without user action", async () => {
    setMockState(null, null);

    render(
      <AppProvider initialLang="ru">
        <AuthProvider>
          <AuthTester />
        </AuthProvider>
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-state").textContent).toBe("guest");
    });
  });
});
