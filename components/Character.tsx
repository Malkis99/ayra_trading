"use client";

import React from "react";
import type { AvatarAppearance } from "@/lib/avatar";
import { Figure } from "@/components/Figure";

export type CharacterSize = "avatar" | "mini" | "card" | "preview" | "hero" | "fill";
export type CharacterVariant = "front" | "back";

const SIZES: Record<CharacterSize, { width: number | string; height: number | string }> = {
  avatar: { width: 32, height: 38 }, // sidebar card, top bar
  mini: { width: 48, height: 88 }, // guest profile on /profile-select
  card: { width: 64, height: 110 }, // Home character card
  preview: { width: 120, height: 200 }, // onboarding finale
  hero: { width: 180, height: 300 },
  fill: { width: "85%", height: "85%" }, // fills its container (profile stage, onboarding editor)
};

interface CharacterProps {
  /** Always the player's saved appearance (gameState.profile.appearance) or a profile being shown; no defaults here. */
  appearance: AvatarAppearance;
  equipment: Record<string, number>;
  size?: CharacterSize;
  variant?: CharacterVariant;
  rotateSlowly?: boolean;
  className?: string;
  /** A preview of an option (e.g. outfit swatch), not the player: drawn without the data-character marker. */
  decorative?: boolean;
}

/** Stable text form of the equipped items (for tests and debugging): "slot:item,slot:item". */
export function equipmentKey(equipment: Record<string, number>): string {
  return Object.keys(equipment)
    .filter((slot) => equipment[slot] != null)
    .sort()
    .map((slot) => `${slot}:${equipment[slot]}`)
    .join(",");
}

/** The one character renderer used everywhere (sidebar, top bar, Home, Profile, Wardrobe, onboarding). */
export function Character({ appearance, equipment, size = "card", variant = "front", rotateSlowly, className, decorative }: CharacterProps) {
  const { width, height } = SIZES[size];
  return (
    <Figure
      appearance={appearance}
      equipment={equipment}
      width={width}
      height={height}
      back={variant === "back"}
      rotateSlowly={rotateSlowly}
      className={className}
      data-character={decorative ? undefined : `${appearance.skinTone} ${appearance.hairstyle} ${appearance.hairColor} ${appearance.outfit}`}
      data-equipment={decorative ? undefined : equipmentKey(equipment)}
    />
  );
}
