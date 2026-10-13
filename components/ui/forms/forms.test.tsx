import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  Input,
  NumberInput,
  Textarea,
  Select,
  Autocomplete,
  DateTimePicker,
  Segmented,
  ChipMultiSelect,
  StarRating,
  Toggle,
  Checkbox,
} from "./index";

const flushRaf = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));

describe("Input / NumberInput / Textarea", () => {
  it("links label, hint and error; marks invalid", () => {
    render(<Input label="Instrument" hint="e.g. XAUUSD" error="Required" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Instrument");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(described.split(" ")[0])!.textContent).toBe("Required");
    expect(input.className).toContain("min-h-[44px]");
  });

  it("NumberInput shows units and colours signed values", () => {
    const { rerender } = render(<NumberInput label="P&L" unit="$" signed value="-50" onChange={() => {}} />);
    expect(screen.getByText("$")).toBeTruthy();
    expect(screen.getByLabelText("P&L").className).toContain("text-short");
    expect(screen.getByLabelText("P&L").getAttribute("inputmode")).toBe("decimal");
    rerender(<NumberInput label="P&L" unit="R" signed value="2,5" onChange={() => {}} />);
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.getByLabelText("P&L").className).toContain("text-long");
  });

  it("Textarea shows a character counter for maxLength", () => {
    render(<Textarea label="Notes" maxLength={500} value="hello" onChange={() => {}} />);
    expect(screen.getByText("5 / 500")).toBeTruthy();
  });
});

function SelectHarness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState<string>("");
  const options = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map((l) => ({ value: l.toLowerCase(), label: l }));
  return (
    <Select
      label="Account"
      options={options}
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    />
  );
}

describe("Select", () => {
  it("is a combobox with a placeholder, opens a searchable listbox and picks with the keyboard", async () => {
    const onChange = vi.fn();
    render(<SelectHarness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Account" });
    expect(trigger.textContent).toContain("Выбери…");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await flushRaf();
    expect(screen.getByRole("listbox")).toBeTruthy();
    const search = screen.getByRole("textbox", { name: "Поиск…" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "ec" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Echo"]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("echo");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toContain("Echo");
    expect(document.activeElement).toBe(trigger);
  });

  it("marks the selected option, moves with arrows and closes on Esc without changing", async () => {
    const onChange = vi.fn();
    render(<SelectHarness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Account" });
    fireEvent.click(trigger);
    await flushRaf();
    const search = screen.getByRole("textbox", { name: "Поиск…" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("bravo");
    fireEvent.click(trigger);
    await flushRaf();
    expect(screen.getByRole("option", { name: "Bravo" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Поиск…" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows 'nothing found' for an empty search", async () => {
    render(<SelectHarness />);
    fireEvent.click(screen.getByRole("combobox"));
    await flushRaf();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск…" }), { target: { value: "zzz" } });
    expect(screen.getByText("Ничего не найдено")).toBeTruthy();
  });
});

describe("Autocomplete", () => {
  it("lists recent values first and picks with arrows + Enter", () => {
    const onChange = vi.fn();
    render(<Autocomplete label="Instrument" value="" onChange={onChange} recent={["NAS100"]} suggestions={["XAUUSD", "NAS100", "EURUSD"]} />);
    const input = screen.getByRole("combobox", { name: "Instrument" });
    fireEvent.focus(input);
    expect(screen.getByText("Недавние")).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["NAS100", "XAUUSD", "EURUSD"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("XAUUSD");
  });
});

describe("DateTimePicker", () => {
  it("shows the value readably and picks a day and time without the native widget", async () => {
    const onChange = vi.fn();
    render(<DateTimePicker label="Opened" value="2026-03-10T09:05" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /Opened/ });
    expect(trigger.textContent).toMatch(/10 мар/);
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.click(trigger);
    await flushRaf();
    const grid = screen.getByRole("grid");
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-03-10");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("2026-03-11T09:05");
    fireEvent.change(screen.getByRole("textbox", { name: "Часы" }), { target: { value: "14" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-03-10T14:05");
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("'Now' sets the current time", () => {
    const onChange = vi.fn();
    render(<DateTimePicker label="Opened" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Сейчас" }));
    expect(onChange.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("Segmented / chips / rating / toggle / checkbox", () => {
  it("Segmented is a radiogroup with colour tones and arrow keys", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Direction"
        value="long"
        onChange={onChange}
        options={[
          { value: "long", label: "Long", tone: "long" },
          { value: "short", label: "Short", tone: "short" },
        ]}
      />
    );
    const long = screen.getByRole("radio", { name: "Long" });
    expect(long.getAttribute("aria-checked")).toBe("true");
    expect(long.className).toContain("text-long");
    fireEvent.keyDown(long, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("short");
  });

  it("ChipMultiSelect toggles values and shows a check on selected chips", () => {
    const onChange = vi.fn();
    render(<ChipMultiSelect label="Emotions" value={["calm"]} onChange={onChange} options={[{ value: "calm", label: "Calm" }, { value: "fomo", label: "FOMO" }]} />);
    const calm = screen.getByRole("button", { name: "Calm" });
    expect(calm.getAttribute("aria-pressed")).toBe("true");
    expect(calm.querySelector("svg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "FOMO" }));
    expect(onChange).toHaveBeenCalledWith(["calm", "fomo"]);
    fireEvent.click(calm);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("StarRating sets, moves with arrows and clears", () => {
    const onChange = vi.fn();
    render(<StarRating label="Execution" value={3} onChange={onChange} />);
    const three = screen.getByRole("radio", { name: "3 из 5" });
    expect(three.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(three, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByRole("button", { name: "Сбросить оценку" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("Toggle is a labelled switch; Checkbox toggles", () => {
    const onToggle = vi.fn();
    const onCheck = vi.fn();
    render(
      <>
        <Toggle label="Compact" checked={false} onChange={onToggle} />
        <Checkbox label="Rule followed" checked={false} onChange={onCheck} />
      </>
    );
    fireEvent.click(screen.getByRole("switch", { name: "Compact" }));
    expect(onToggle).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Rule followed" }));
    expect(onCheck).toHaveBeenCalledWith(true);
  });
});
