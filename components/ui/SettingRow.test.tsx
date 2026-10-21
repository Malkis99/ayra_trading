import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingRow } from "./SettingRow";

const renderRow = () =>
  render(
    <SettingRow title="Главный счёт по умолчанию" hint="Этот счёт выбирается сам." hintLabel="Подсказка" data-testid="row">
      <input aria-label="value" />
    </SettingRow>
  );

const hint = () => screen.getByText("Этот счёт выбирается сам.");
const button = () => screen.getByRole("button", { name: "Подсказка: Главный счёт по умолчанию" });

describe("«?» hint of a setting (setup plan section 2)", () => {
  it("is the description of the question for screen readers, hidden until asked", () => {
    renderRow();
    const group = screen.getByRole("group", { name: "Главный счёт по умолчанию" });
    expect(group.getAttribute("aria-describedby")).toBe(hint().id);
    expect(hint().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on hover and closes when the pointer leaves", () => {
    renderRow();
    fireEvent.mouseEnter(button());
    expect(hint().hidden).toBe(false);
    fireEvent.mouseLeave(button());
    expect(hint().hidden).toBe(true);
  });

  it("opens on keyboard focus; Esc closes it", () => {
    renderRow();
    fireEvent.focus(button());
    expect(hint().hidden).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hint().hidden).toBe(true);
  });

  it("a tap opens it, a second tap closes it", () => {
    renderRow();
    fireEvent.focus(button()); // a tap focuses the button first
    fireEvent.click(button());
    expect(hint().hidden).toBe(false);
    fireEvent.click(button());
    expect(hint().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });
});
