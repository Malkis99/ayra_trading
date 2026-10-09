import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { sanitizeRedirectUrl } from "./redirect-whitelist";
import { mockIsNicknameAvailable, mockSetNickname } from "./mock-auth";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppProvider } from "@/lib/context";
import { AuthProvider } from "./auth-context";
import { GameProvider } from "@/lib/game-context";
import { JournalProvider } from "@/lib/journal/context";
import LoginPage from "@/app/login/page";
import TermsPage from "@/app/legal/terms/page";
import PrivacyPage from "@/app/legal/privacy/page";
import SettingsPage from "@/app/settings/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

function renderWithProviders(ui: React.ReactNode, lang: "ru" | "en" = "ru") {
  localStorage.setItem("ayra_lang", lang);
  return render(
    <AppProvider initialLang={lang}>
      <AuthProvider>
        <GameProvider>
          <JournalProvider>{ui}</JournalProvider>
        </GameProvider>
      </AuthProvider>
    </AppProvider>
  );
}

describe("T7a Auth: Redirect Whitelist Validator", () => {
  it("allows safe relative redirect paths", () => {
    expect(sanitizeRedirectUrl("/")).toBe("/");
    expect(sanitizeRedirectUrl("/journal")).toBe("/journal");
    expect(sanitizeRedirectUrl("/settings?tab=account")).toBe("/settings?tab=account");
    expect(sanitizeRedirectUrl("/awakening#step1")).toBe("/awakening#step1");
  });

  it("blocks dangerous open redirect URLs and falls back to /", () => {
    expect(sanitizeRedirectUrl("http://evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("https://phishing.site/login")).toBe("/");
    expect(sanitizeRedirectUrl("//evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("/\\evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
    expect(sanitizeRedirectUrl(null)).toBe("/");
    expect(sanitizeRedirectUrl(undefined)).toBe("/");
  });
});

describe("T7a Auth: Nickname Uniqueness & Validation Mock", () => {
  it("validates nickname format and uniqueness correctly", () => {
    expect(mockIsNicknameAvailable("Valid_Trader_1")).toBe(true);
    expect(mockIsNicknameAvailable("taken_nick")).toBe(false);
    expect(mockIsNicknameAvailable("admin")).toBe(false);
    expect(mockIsNicknameAvailable("ab")).toBe(false); // too short
    expect(mockIsNicknameAvailable("CyrillicНик")).toBe(false);
  });

  it("reserves nickname upon setting", () => {
    const success = mockSetNickname("New_Unique_Nick");
    expect(success).toBe(true);
    expect(mockIsNicknameAvailable("New_Unique_Nick")).toBe(true); // own nickname
  });
});

describe("T7a Auth: Supabase Factories Guest Mode Fallbacks", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("browser client returns null in guest mode without crashing", () => {
    const client = createSupabaseBrowserClient();
    expect(client).toBeNull();
  });

  it("server client returns null in guest mode without crashing", () => {
    const client = createSupabaseServerClient();
    expect(client).toBeNull();
  });
});

describe("T7a Security: Client Bundle & Source Secret Protection", () => {
  it("ensures no service_role key string exists in client code or app files", () => {
    const clientDirs = ["app", "components", "lib"];
    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!fullPath.includes("node_modules") && !fullPath.includes(".next")) {
            scanDir(fullPath);
          }
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
          !entry.name.endsWith(".test.ts") &&
          !entry.name.endsWith(".test.tsx")
        ) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.includes("SUPABASE_SERVICE_ROLE_KEY") || content.includes("service_role_key")) {
            violations.push(fullPath);
          }
        }
      }
    }

    clientDirs.forEach((dir) => {
      if (fs.existsSync(dir)) scanDir(dir);
    });

    expect(violations).toEqual([]);
  });
});

describe("T7a i18n & UI Rendering", () => {
  it("renders /login in RU and EN without Cyrillic leakage in EN", () => {
    const { container: ruContainer } = renderWithProviders(<LoginPage />, "ru");
    expect(ruContainer.textContent).toContain("Вход в AYRA");

    const { container: enContainer } = renderWithProviders(<LoginPage />, "en");
    expect(enContainer.textContent).toContain("Sign in to AYRA");
    expect(enContainer.textContent).not.toMatch(/[а-яА-ЯёЁ]/);
  });

  it("renders /legal/terms in RU and EN without Cyrillic leakage in EN", () => {
    const { container: ruContainer } = renderWithProviders(<TermsPage />, "ru");
    expect(ruContainer.textContent).toContain("ЧЕРНОВИК ДОКУМЕНТА");

    const { container: enContainer } = renderWithProviders(<TermsPage />, "en");
    expect(enContainer.textContent).toContain("DRAFT DOCUMENT");
    expect(enContainer.textContent).not.toMatch(/[а-яА-ЯёЁ]/);
  });

  it("renders /legal/privacy in RU and EN without Cyrillic leakage in EN", () => {
    const { container: ruContainer } = renderWithProviders(<PrivacyPage />, "ru");
    expect(ruContainer.textContent).toContain("ЧЕРНОВИК ДОКУМЕНТА");

    const { container: enContainer } = renderWithProviders(<PrivacyPage />, "en");
    expect(enContainer.textContent).toContain("DRAFT DOCUMENT");
    expect(enContainer.textContent).not.toMatch(/[а-яА-ЯёЁ]/);
  });

  it("renders Settings Account section in RU and EN without Cyrillic leakage in EN", () => {
    const { container: ruContainer } = renderWithProviders(<SettingsPage />, "ru");
    expect(ruContainer.textContent).toContain("Аккаунт");

    const { container: enContainer } = renderWithProviders(<SettingsPage />, "en");
    expect(enContainer.textContent).toContain("Account");
    expect(enContainer.textContent).not.toMatch(/[а-яА-ЯёЁ]/);
  });
});
