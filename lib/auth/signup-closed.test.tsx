import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppProvider } from "@/lib/context";
import { AuthProvider } from "./auth-context";
import { GameProvider } from "@/lib/game-context";
import { JournalProvider } from "@/lib/journal/context";
import LoginPage from "@/app/login/page";
import { EMAIL_SENDING_READY, authEmailFlowsOpen } from "./email-sending";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

function renderLogin(lang: "ru" | "en") {
  localStorage.setItem("ayra_lang", lang);
  return render(
    <AppProvider initialLang={lang}>
      <AuthProvider>
        <GameProvider>
          <JournalProvider>
            <LoginPage />
          </JournalProvider>
        </GameProvider>
      </AuthProvider>
    </AppProvider>
  );
}

describe("registration and «Forgot password» closed until custom SMTP (auth plan PR A)", () => {
  it("production default: letters are not sent, so both flows are closed", () => {
    expect(EMAIL_SENDING_READY).toBe(false);
    expect(authEmailFlowsOpen()).toBe(false);
  });

  it("sign in by password stays; no «Forgot password»; the hint points to Settings", () => {
    renderLogin("ru");
    expect(screen.getByRole("tab", { name: "Вход" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("#password-input")).not.toBeNull();
    expect(screen.queryByTestId("forgot-link")).toBeNull();
    expect(screen.getByTestId("old-account-hint").textContent).toContain("Настройки → «Создать пароль»");
  });

  it("the «Sign up» tab says registration opens soon and has no form", () => {
    renderLogin("ru");
    fireEvent.click(screen.getByRole("tab", { name: "Регистрация" }));
    const closed = screen.getByTestId("signup-closed");
    expect(closed.textContent).toContain("Регистрация скоро откроется");
    expect(document.querySelector("#email-input")).toBeNull();
    expect(screen.queryByTestId("login-consent")).toBeNull();
  });

  it("EN has the same texts without Cyrillic", () => {
    const { container } = renderLogin("en");
    fireEvent.click(screen.getByRole("tab", { name: "Sign up" }));
    expect(screen.getByTestId("signup-closed").textContent).toContain("Sign-up opens soon");
    expect(container.textContent).not.toMatch(/[а-яА-ЯёЁ]/);
  });
});
