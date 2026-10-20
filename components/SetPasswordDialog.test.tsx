import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { getDictionary } from "@/lib/i18n";

const auth = {
  user: { id: "u1", email: "me@example.com", hasPassword: false } as { id: string; email: string; hasPassword: boolean },
  setPassword: vi.fn(async (..._args: unknown[]) => ({ success: true }) as { success: boolean; errorKey?: string; errorDetails?: unknown }),
};
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/lib/context", () => {
  const app = () => ({ dict: getDictionary("ru"), lang: "ru", showToast: vi.fn() });
  return { useApp: app, useOptionalApp: app };
});

import { SetPasswordDialog } from "./SetPasswordDialog";

const save = () => fireEvent.click(screen.getByTestId("password-save"));
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", hasPassword: false };
  auth.setPassword.mockReset();
  auth.setPassword.mockResolvedValue({ success: true });
});

describe("«Create password» / «Change password» dialog (auth plan PR B)", () => {
  it("create: no current-password field; a short password is refused before anything is sent", async () => {
    const onSaved = vi.fn();
    render(<SetPasswordDialog isOpen onClose={() => {}} onSaved={onSaved} />);
    expect(screen.getByTestId("set-password-dialog").textContent).toContain("Создать пароль");
    expect(screen.queryByTestId("password-current")).toBeNull();
    type("password-new", "short");
    save();
    expect(await screen.findByText("Пароль должен быть не короче 8 символов")).toBeTruthy();
    expect(auth.setPassword).not.toHaveBeenCalled();

    type("password-new", "rainy morning trades");
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(auth.setPassword).toHaveBeenCalledWith("rainy morning trades", undefined);
  });

  it("change: asks the current password; a wrong one is shown on that field", async () => {
    auth.user.hasPassword = true;
    auth.setPassword.mockResolvedValue({ success: false, errorKey: "wrongCurrent" });
    render(<SetPasswordDialog isOpen onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByTestId("set-password-dialog").textContent).toContain("Сменить пароль");
    type("password-new", "sunny evening trades");
    save();
    expect(await screen.findByText("Введи пароль")).toBeTruthy(); // current is empty
    expect(auth.setPassword).not.toHaveBeenCalled();

    type("password-current", "wrong one");
    save();
    expect(await screen.findByText("Текущий пароль неверный")).toBeTruthy();
    expect(auth.setPassword).toHaveBeenCalledWith("sunny evening trades", "wrong one");
  });

  it("a server refusal shows a clear message with «Technical details»", async () => {
    auth.setPassword.mockResolvedValue({
      success: false,
      errorKey: "samePassword",
      errorDetails: { errorKey: "x", sanitizedMessage: "same_password", errorName: "AuthApiError", status: 422, timestamp: "2026-10-20T10:00:00.000Z" },
    });
    render(<SetPasswordDialog isOpen onClose={() => {}} onSaved={() => {}} />);
    type("password-new", "rainy morning trades");
    save();
    const err = await screen.findByTestId("password-error");
    expect(err.textContent).toContain("Новый пароль совпадает с текущим");
    expect(err.textContent).toContain("Технические детали");
    expect(err.textContent).toContain("422");
  });

  it("«Show password» switches the field between hidden and visible", () => {
    render(<SetPasswordDialog isOpen onClose={() => {}} onSaved={() => {}} />);
    const field = screen.getByTestId("password-new") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Показать пароль" }));
    expect(field.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Скрыть пароль" }));
    expect(field.type).toBe("password");
  });
});

describe("errors disappear as soon as the field is edited", () => {
  it("the length error goes away when the new password is typed again", async () => {
    render(<SetPasswordDialog isOpen onClose={() => {}} onSaved={() => {}} />);
    type("password-new", "short");
    save();
    expect(await screen.findByText("Пароль должен быть не короче 8 символов")).toBeTruthy();
    type("password-new", "rainy morning trades");
    expect(screen.queryByText("Пароль должен быть не короче 8 символов")).toBeNull();
    expect(screen.getByText("Минимум 8 символов. Лучше фраза из нескольких слов")).toBeTruthy();
  });
});
