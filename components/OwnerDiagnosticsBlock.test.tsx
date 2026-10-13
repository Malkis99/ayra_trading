import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OwnerDiagnosticsBlock } from "@/components/OwnerDiagnosticsBlock";
import { AppProvider } from "@/lib/context";
import { AuthProvider } from "@/lib/auth/auth-context";
import { AppStorage } from "@/lib/storage";

describe("OwnerDiagnosticsBlock Unit Test", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders diagnostics without PII, tokens, or email addresses", async () => {
    AppStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({
        onboarding: { status: "done" },
      })
    );

    render(
      <AppProvider initialLang="ru">
        <AuthProvider>
          <OwnerDiagnosticsBlock />
        </AuthProvider>
      </AppProvider>
    );

    const titleBtn = screen.getByText(/Диагностика/i);
    expect(titleBtn).not.toBeNull();

    // Open collapsable summary
    fireEvent.click(titleBtn);

    await waitFor(() => {
      expect(screen.getByText(/Состояние авторизации/i)).not.toBeNull();
    });

    const bodyText = document.body.textContent || "";
    // Ensure no sensitive keywords like tokens, emails, keys exist
    expect(bodyText).not.toMatch(/@/);
    expect(bodyText).not.toMatch(/token/i);
    expect(bodyText).not.toMatch(/secret/i);
    expect(bodyText).not.toMatch(/password/i);
  });
});
