import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { AppProvider } from "./lib/context";
import { GameProvider } from "./lib/game-context";
import { JournalProvider } from "./lib/journal/context";
import { AuthProvider } from "./lib/auth/auth-context";
import ProfilePage from "./app/profile/page";
import HomePage from "./app/page";
import QuestsPage from "./app/quests/page";
import PlansPage from "./app/plans/page";
import { AddModal } from "./components/AddModal";
import { ALLOWED_LATIN_WORDS } from "./lib/i18n/allowed-latin";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

function renderWithProviders(ui: React.ReactNode, lang: "ru" | "en" = "ru") {
  localStorage.setItem("ayra_lang", lang);
  return render(
    <AppProvider initialLang={lang}>
      <AuthProvider>
        <GameProvider>
          <JournalProvider>
            {ui}
          </JournalProvider>
        </GameProvider>
      </AuthProvider>
    </AppProvider>
  );
}

describe("i18n Leakage rendered page tests", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders ProfilePage in RU (all tabs) without disallowed English words in visible text", () => {
    const allowed = new Set([
      ...ALLOWED_LATIN_WORDS,
      "TraderOne", // Default Latin user nickname
    ]);

    const tabNames = ["Overview", "Wardrobe", "Achievements", "Chronicle", "Posts", "Stats"];

    tabNames.forEach((_, tabIdx) => {
      // Mock window search param for tab switching
      delete (window as any).location;
      (window as any).location = new URL(`http://localhost/profile?tab=${["overview", "wardrobe", "achievements", "chronicle", "posts", "stats"][tabIdx]}`);

      const { container } = renderWithProviders(<ProfilePage />, "ru");
      const clone = container.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("style, script").forEach((el) => el.remove());
      const text = clone.textContent || "";

      let cleaned = text;
      allowed.forEach((word) => {
        const regex = new RegExp(`\\b${word}\\b`, "gi");
        cleaned = cleaned.replace(regex, "");
      });

      const latinMatches = cleaned.match(/\b[A-Za-z]{2,}\b/g) || [];
      expect(latinMatches).toEqual([]);
    });
  });

  it("renders ProfilePage in EN without Cyrillic characters", () => {
    const { container } = renderWithProviders(<ProfilePage />, "en");
    const text = container.textContent || "";
    const cyrillicMatches = text.match(/[а-яА-ЯёЁ]/g) || [];
    expect(cyrillicMatches).toEqual([]);
  });

  it("renders HomePage, QuestsPage, PlansPage and AddModal in EN without Cyrillic", () => {
    const { container: homeContainer } = renderWithProviders(<HomePage />, "en");
    expect(homeContainer.textContent || "").not.toMatch(/[а-яА-ЯёЁ]/);

    const { container: questsContainer } = renderWithProviders(<QuestsPage />, "en");
    expect(questsContainer.textContent || "").not.toMatch(/[а-яА-ЯёЁ]/);

    const { container: plansContainer } = renderWithProviders(<PlansPage />, "en");
    expect(plansContainer.textContent || "").not.toMatch(/[а-яА-ЯёЁ]/);

    const { container: modalContainer } = renderWithProviders(<AddModal />, "en");
    expect(modalContainer.textContent || "").not.toMatch(/[а-яА-ЯёЁ]/);
  });
});
