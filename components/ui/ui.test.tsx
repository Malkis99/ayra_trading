import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, Tabs, Modal, EmptyState, Chip, SectionHeader } from "./index";

function TabsHarness() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <Tabs
      label="Sections"
      value={value}
      onChange={setValue}
      items={[
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ]}
    />
  );
}

describe("components/ui", () => {
  it("Button defaults to type=button and keeps a 44px tap target at md", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.className).toContain("min-h-[44px]");
  });

  it("Tabs expose tablist semantics and move selection with arrow keys", () => {
    render(<TabsHarness />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeTruthy();
    const a = screen.getByRole("tab", { name: "A" });
    expect(a.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "C" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "C" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Modal is a labelled dialog, closes on Esc and on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen onClose={onClose} title="Edit" closeLabel="Close">
        <input aria-label="Name" />
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Edit" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.body.querySelector('div[aria-hidden="true"]')!); // backdrop (rendered in a portal)
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Modal traps Tab focus inside the dialog", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Trap" closeLabel="Close">
        <button type="button">Last</button>
      </Modal>
    );
    const close = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Modal renders nothing when closed", () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Hidden" closeLabel="Close">
        x
      </Modal>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("EmptyState, Chip and SectionHeader render their content", () => {
    render(
      <>
        <EmptyState title="Nothing yet" description="Add the first item" action={<Button>Add</Button>} />
        <Chip tone="gold">Rare</Chip>
        <SectionHeader title="Today" action={<a href="#x">All</a>} />
      </>
    );
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.getByText("Rare").className).toContain("text-go");
    expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeTruthy();
  });
});
