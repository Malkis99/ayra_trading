import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Character, equipmentKey } from "./Character";
import { getHairColorPreset, getOutfitPreset, getSkinTonePreset } from "@/lib/avatar";
import { ITEMS } from "@/lib/items";

const LOOK = { skinTone: "skin_deep", hairstyle: "hair_dreads", hairColor: "hair_cyan", outfit: "outfit_crimson" };

describe("Character", () => {
  it("draws exactly the given presets (no local defaults)", () => {
    const { container } = render(<Character appearance={LOOK} equipment={{}} size="avatar" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-character")).toBe("skin_deep hair_dreads hair_cyan outfit_crimson");
    expect(svg.getAttribute("width")).toBe("32");
    const fills = Array.from(svg.querySelectorAll("[fill]")).map((el) => el.getAttribute("fill"));
    expect(fills).toContain(getSkinTonePreset("skin_deep").hex);
    expect(fills).toContain(getHairColorPreset("hair_cyan").hex);
  });

  it("renders the same look in every size and on the back side", () => {
    for (const size of ["avatar", "mini", "card", "preview", "hero", "fill"] as const) {
      for (const variant of ["front", "back"] as const) {
        const { container, unmount } = render(<Character appearance={LOOK} equipment={{ Верх: 1 }} size={size} variant={variant} />);
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("data-character")).toBe("skin_deep hair_dreads hair_cyan outfit_crimson");
        expect(svg.getAttribute("data-equipment")).toBe("Верх:1");
        unmount();
      }
    }
  });

  it("starter clothes show the chosen outfit style; real wardrobe items override it", () => {
    const outfit = getOutfitPreset("outfit_crimson");
    const fillsOf = (equipment: Record<string, number>) => {
      const { container, unmount } = render(<Character appearance={LOOK} equipment={equipment} />);
      const fills = Array.from(container.querySelectorAll("[fill]")).map((el) => el.getAttribute("fill"));
      unmount();
      return fills;
    };
    const starter = fillsOf({ Верх: 0, Низ: 3, Обувь: 5 });
    expect(starter).toContain(outfit.topColor);
    expect(starter).toContain(outfit.bottomColor);
    expect(starter).not.toContain(ITEMS[0].color);
    const hoodie = fillsOf({ Верх: 1, Низ: 3, Обувь: 5 });
    expect(hoodie).toContain(ITEMS[1].color);
    expect(hoodie).not.toContain(outfit.topColor);
  });

  it("equipmentKey is stable and skips empty slots", () => {
    expect(equipmentKey({ Низ: 3, Верх: 1, Голова: undefined as unknown as number })).toBe("Верх:1,Низ:3");
  });

  it("no page or component draws the character with Figure directly", () => {
    const roots = ["app", "components", "lib"].map((d) => path.join(process.cwd(), d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/Character\.(test\.)?tsx$|Figure\.tsx$/.test(entry.name)) {
          if (/from ["']@\/components\/Figure["']|from ["']\.\/Figure["']/.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
