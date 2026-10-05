"use client";

import React from "react";
import { ITEMS, SlotName } from "@/lib/items";
import { DEFAULT_AVATAR } from "@/lib/avatar";

interface FigureProps {
  equipment?: Record<string, number>;
  viewBox?: string;
  width?: number | string;
  height?: number | string;
  back?: boolean;
  className?: string;
}

export function Figure({
  equipment = {},
  viewBox = "0 0 100 230",
  width = 100,
  height = 230,
  back = false,
  className = "",
}: FigureProps) {
  function getColor(slot: SlotName, defaultColor: string): string {
    const itemIdx = equipment[slot];
    if (itemIdx != null && ITEMS[itemIdx]) {
      return ITEMS[itemIdx].color;
    }
    return defaultColor;
  }

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={`select-none ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="auraGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={getColor("Аура", "#a38ad1")} stopOpacity="0.35" />
          <stop offset="100%" stopColor={getColor("Аура", "#a38ad1")} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Aura */}
      {equipment["Аура"] != null && (
        <ellipse
          cx="50"
          cy="120"
          rx="48"
          ry="96"
          fill="url(#auraGlow)"
          className="animate-pulse motion-reduce:animate-none"
        />
      )}

      {/* Cloak */}
      {equipment["Плащ"] != null && (
        <path
          d="M24 62L76 62L92 205L8 205Z"
          fill={getColor("Плащ", "#2a1d5c")}
          opacity="0.9"
        />
      )}

      {/* Legs Base & Pants */}
      <path
        d="M32 135L68 135L66 218L53 218L50 160L47 218L34 218Z"
        fill={getColor("Низ", DEFAULT_AVATAR.basePantsColor)}
      />

      {/* Feet & Shoes */}
      <ellipse
        cx="41"
        cy="221"
        rx="9"
        ry="4"
        fill={getColor("Обувь", "#444452")}
      />
      <ellipse
        cx="59"
        cy="221"
        rx="9"
        ry="4"
        fill={getColor("Обувь", "#444452")}
      />

      {/* Torso Base & Shirt */}
      <path
        d="M22 64Q50 50 78 64L85 142L72 142L70 96L68 142L32 142L30 96L28 142L15 142Z"
        fill={getColor("Верх", DEFAULT_AVATAR.baseShirtColor)}
      />

      {/* Outerwear */}
      {equipment["Верхняя"] != null && (
        <path
          d="M22 64Q50 50 78 64L86 145L62 145L50 88L38 145L14 145Z"
          fill={getColor("Верхняя", "#30286e")}
          opacity="0.95"
        />
      )}

      {/* Neck */}
      <rect
        x="45"
        y="46"
        width="10"
        height="12"
        rx="2"
        fill={DEFAULT_AVATAR.skinColor}
      />

      {/* Hands */}
      {equipment["Перчатки"] != null ? (
        <>
          <circle cx="15" cy="146" r="5" fill={getColor("Перчатки", "#d6d6e0")} />
          <circle cx="85" cy="146" r="5" fill={getColor("Перчатки", "#d6d6e0")} />
        </>
      ) : (
        <>
          <circle cx="15" cy="146" r="4.5" fill={DEFAULT_AVATAR.skinColor} />
          <circle cx="85" cy="146" r="4.5" fill={DEFAULT_AVATAR.skinColor} />
        </>
      )}

      {/* Head */}
      {back ? (
        <>
          <circle cx="50" cy="34" r="15" fill={DEFAULT_AVATAR.hairColor} />
          <ellipse cx="50" cy="36" rx="14" ry="15" fill={DEFAULT_AVATAR.hairColor} />
        </>
      ) : (
        <>
          {/* Ears */}
          <circle cx="34" cy="36" r="3" fill={DEFAULT_AVATAR.skinColor} />
          <circle cx="66" cy="36" r="3" fill={DEFAULT_AVATAR.skinColor} />

          {/* Head Shape */}
          <ellipse cx="50" cy="36" rx="14" ry="16" fill={DEFAULT_AVATAR.skinColor} />

          {/* Facial Features */}
          {/* Eyes */}
          <ellipse cx="44" cy="35" rx="2" ry="1.5" fill={DEFAULT_AVATAR.eyeColor} />
          <ellipse cx="56" cy="35" rx="2" ry="1.5" fill={DEFAULT_AVATAR.eyeColor} />

          {/* Eyebrows */}
          <path d="M41 31Q44 29 47 31" stroke={DEFAULT_AVATAR.hairColor} strokeWidth="1.2" fill="none" />
          <path d="M53 31Q56 29 59 31" stroke={DEFAULT_AVATAR.hairColor} strokeWidth="1.2" fill="none" />

          {/* Nose & Mouth */}
          <path d="M50 36L49.5 39L51 39" stroke="#b38769" strokeWidth="1" fill="none" />
          <path d="M47 43Q50 45 53 43" stroke="#aa7a5b" strokeWidth="1.2" fill="none" />

          {/* Hair */}
          <path
            d="M34 32Q50 12 66 32Q50 22 34 32Z"
            fill={DEFAULT_AVATAR.hairColor}
          />
        </>
      )}

      {/* Headwear */}
      {equipment["Голова"] != null && (
        ITEMS[equipment["Голова"]]?.rarity === 2 ? (
          <path
            d="M34 26L40 10L46 22L50 8L54 22L60 10L66 26Z"
            fill={getColor("Голова", "#d6a94a")}
          />
        ) : (
          <path
            d="M33 28Q50 8 67 28L73 31L33 31Z"
            fill={getColor("Голова", "#50348f")}
          />
        )
      )}

      {/* Glasses / Accessory */}
      {!back && equipment["Аксессуар"] != null && (
        <>
          <rect
            x="38"
            y="32"
            width="10"
            height="6"
            rx="2"
            fill="none"
            stroke={getColor("Аксессуар", "#a38ad1")}
            strokeWidth="1.5"
          />
          <rect
            x="52"
            y="32"
            width="10"
            height="6"
            rx="2"
            fill="none"
            stroke={getColor("Аксессуар", "#a38ad1")}
            strokeWidth="1.5"
          />
          <line x1="48" y1="35" x2="52" y2="35" stroke={getColor("Аксессуар", "#a38ad1")} strokeWidth="1.5" />
        </>
      )}

      {/* Companion */}
      {equipment["Компаньон"] != null && (
        <g className="animate-bounce motion-reduce:animate-none">
          <circle
            cx="88"
            cy="44"
            r="6"
            fill={getColor("Компаньон", "#a38ad1")}
          />
          <circle
            cx="88"
            cy="44"
            r="8"
            fill="none"
            stroke={getColor("Компаньон", "#a38ad1")}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
        </g>
      )}
    </svg>
  );
}
