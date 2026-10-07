"use client";

import React from "react";
import { ITEMS, SlotName } from "@/lib/items";
import {
  AvatarAppearance,
  DEFAULT_AVATAR_APPEARANCE,
  getSkinTonePreset,
  getHairColorPreset,
  getOutfitPreset,
  validateAvatarAppearance,
} from "@/lib/avatar";

interface FigureProps {
  equipment?: Record<string, number>;
  appearance?: AvatarAppearance;
  viewBox?: string;
  width?: number | string;
  height?: number | string;
  back?: boolean;
  className?: string;
  rotateSlowly?: boolean;
}

export function Figure({
  equipment = {},
  appearance = DEFAULT_AVATAR_APPEARANCE,
  viewBox = "0 0 100 230",
  width = "100%",
  height = "100%",
  back = false,
  className = "",
  rotateSlowly = false,
}: FigureProps) {
  const validApp = validateAvatarAppearance(appearance);
  const skinPreset = getSkinTonePreset(validApp.skinTone);
  const hairColorPreset = getHairColorPreset(validApp.hairColor);
  const outfitPreset = getOutfitPreset(validApp.outfit);

  const skinTone = skinPreset.hex;
  const shadowTone = skinPreset.shadowHex;
  const hairColor = hairColorPreset.hex;

  function getColor(slot: SlotName, defaultColor: string): string {
    const itemIdx = equipment[slot];
    if (itemIdx != null && ITEMS[itemIdx]) {
      return ITEMS[itemIdx].color;
    }
    return defaultColor;
  }

  const topColor = getColor("Верх", outfitPreset.topColor);
  const bottomColor = getColor("Низ", outfitPreset.bottomColor);
  const shoesColor = getColor("Обувь", outfitPreset.shoesColor);

  function renderHair(styleId: string) {
    switch (styleId) {
      case "hair_buzz":
        return (
          <path
            d="M36 28C36 20 64 20 64 28C64 30 36 30 36 28Z"
            fill={hairColor}
          />
        );
      case "hair_bob":
        return (
          <g fill={hairColor}>
            <path d="M32 34C30 18 70 18 68 34L70 44L65 44L65 30C65 22 35 22 35 30L35 44L30 44Z" />
          </g>
        );
      case "hair_wavy_medium":
        return (
          <g fill={hairColor}>
            <path d="M32 30C32 16 68 16 68 30C70 42 66 48 64 50C62 48 66 38 64 30C60 20 40 20 36 30C34 38 38 48 36 50C34 48 30 42 32 30Z" />
          </g>
        );
      case "hair_curly":
        return (
          <g fill={hairColor}>
            <circle cx="36" cy="24" r="5" />
            <circle cx="44" cy="20" r="6" />
            <circle cx="53" cy="20" r="6" />
            <circle cx="61" cy="23" r="5" />
            <circle cx="66" cy="29" r="4" />
            <circle cx="33" cy="29" r="4" />
            <path d="M33 30Q50 14 67 30C62 22 38 22 33 30Z" />
          </g>
        );
      case "hair_long_straight":
        return (
          <g fill={hairColor}>
            <path d="M32 30C32 16 68 16 68 30L72 65L66 65L66 30C66 22 34 22 34 30L34 65L28 65Z" />
          </g>
        );
      case "hair_dreads":
        return (
          <g fill={hairColor} stroke={hairColor} strokeWidth="2">
            <path d="M34 28L30 52" />
            <path d="M39 24L36 56" />
            <path d="M45 22L44 58" />
            <path d="M55 22L56 58" />
            <path d="M61 24L64 56" />
            <path d="M66 28L70 52" />
          </g>
        );
      case "hair_ponytail":
        return (
          <g fill={hairColor}>
            <path d="M33 32Q50 12 67 32C62 24 38 24 33 32Z" />
            <path d="M64 26C72 26 78 35 76 48C73 48 70 38 64 30Z" />
          </g>
        );
      case "hair_short_fade":
      default:
        return (
          <path
            d="M33 32Q50 12 67 32C62 24 38 24 33 32Z"
            fill={hairColor}
          />
        );
    }
  }

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      className={`motion-safe:animate-[breath_4s_easeInOut_infinite] ${
        rotateSlowly ? "motion-safe:animate-[slowRotate_12s_linear_infinite]" : ""
      } ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>
          {`
            @keyframes breath {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(-2px); }
            }
            @keyframes slowRotate {
              0% { transform: rotateY(0deg); }
              50% { transform: rotateY(180deg); }
              100% { transform: rotateY(360deg); }
            }
          `}
        </style>
      </defs>

      {/* Aura */}
      {equipment["Аура"] != null && (
        <ellipse
          cx="50"
          cy="120"
          rx="54"
          ry="108"
          fill={getColor("Аура", "#a38ad1")}
          opacity="0.18"
          stroke={getColor("Аура", "#a38ad1")}
          strokeOpacity="0.6"
          strokeDasharray="4 2"
        />
      )}

      {/* Cloak */}
      {equipment["Плащ"] != null && (
        <path
          d="M24 66L76 66L94 205L6 205Z"
          fill={getColor("Плащ", "#2a1d5c")}
          opacity="0.9"
        />
      )}

      {/* Base Legs & Trousers */}
      <path
        d="M32 140L68 140L66 222L53 222L50 165L47 222L34 222Z"
        fill={bottomColor}
      />

      {/* Shoes */}
      <ellipse
        cx="42"
        cy="224"
        rx="10"
        ry="4"
        fill={shoesColor}
      />
      <ellipse
        cx="58"
        cy="224"
        rx="10"
        ry="4"
        fill={shoesColor}
      />

      {/* Neck & Hands (Body details) */}
      <rect x="45" y="48" width="10" height="12" rx="2" fill={skinTone} />

      {/* Base Shirt (Torso) */}
      <path
        d="M22 68Q50 54 78 68L86 148L72 148L70 100L68 148L32 148L30 100L28 148L14 148Z"
        fill={topColor}
      />

      {/* Hands / Wrists */}
      <circle cx="14" cy="148" r="4.5" fill={skinTone} />
      <circle cx="86" cy="148" r="4.5" fill={skinTone} />

      {/* Outerwear */}
      {equipment["Верхняя"] != null && (
        <path
          d="M22 68Q50 54 78 68L86 150L62 150L50 92L38 150L14 150Z"
          fill={getColor("Верхняя", "#30286e")}
          opacity="0.95"
        />
      )}

      {/* Gloves */}
      {equipment["Перчатки"] != null && (
        <>
          <circle cx="14" cy="148" r="6" fill={getColor("Перчатки", "#d6d6e0")} />
          <circle cx="86" cy="148" r="6" fill={getColor("Перчатки", "#d6d6e0")} />
        </>
      )}

      {/* Head, Ears & Hair */}
      {back ? (
        <>
          <circle cx="50" cy="36" r="16" fill={skinTone} />
          {renderHair(validApp.hairstyle)}
        </>
      ) : (
        <>
          {/* Ears */}
          <circle cx="33" cy="37" r="3.5" fill={skinTone} />
          <circle cx="67" cy="37" r="3.5" fill={skinTone} />

          {/* Head Base */}
          <circle cx="50" cy="36" r="16" fill={skinTone} />

          {/* Hair Top */}
          {renderHair(validApp.hairstyle)}

          {/* Facial features: Eyebrows, Eyes, Nose */}
          <path d="M41 31Q44 29 47 31" stroke={hairColor} strokeWidth="1.2" fill="none" />
          <path d="M53 31Q56 29 59 31" stroke={hairColor} strokeWidth="1.2" fill="none" />

          {/* Eyes */}
          <circle cx="44" cy="35" r="1.5" fill="#1f1f28" />
          <circle cx="56" cy="35" r="1.5" fill="#1f1f28" />

          {/* Nose hint */}
          <path d="M50 37L49 40H51" stroke={shadowTone} strokeWidth="1" strokeLinecap="round" fill="none" />
        </>
      )}

      {/* Headwear */}
      {equipment["Голова"] != null && (
        ITEMS[equipment["Голова"]]?.rarity === 2 ? (
          <path
            d="M34 28L40 12L46 24L50 10L54 24L60 12L66 28Z"
            fill={getColor("Голова", "#d6a94a")}
          />
        ) : (
          <path
            d="M33 30Q50 10 67 30L73 33L33 33Z"
            fill={getColor("Голова", "#50348f")}
          />
        )
      )}

      {/* Glasses / Accessory */}
      {!back && equipment["Аксессуар"] != null && (
        <>
          <rect
            x="38"
            y="33"
            width="10"
            height="6"
            rx="2"
            fill="none"
            stroke={getColor("Аксессуар", "#a38ad1")}
            strokeWidth="1.5"
          />
          <rect
            x="52"
            y="33"
            width="10"
            height="6"
            rx="2"
            fill="none"
            stroke={getColor("Аксессуар", "#a38ad1")}
            strokeWidth="1.5"
          />
        </>
      )}

      {/* Companion */}
      {equipment["Компаньон"] != null && (
        <circle
          cx="90"
          cy="48"
          r="6"
          fill={getColor("Компаньон", "#a38ad1")}
        />
      )}
    </svg>
  );
}
