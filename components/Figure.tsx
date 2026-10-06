"use client";

import React from "react";
import { ITEMS, SlotName } from "@/lib/items";

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

  const skinTone = "#d1a886";
  const hairColor = "#221915";

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={`motion-safe:animate-[breath_4s_easeInOut_infinite] ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>
          {`
            @keyframes breath {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(-2px); }
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
        fill={getColor("Низ", "#2b2b36")}
      />

      {/* Shoes */}
      <ellipse
        cx="42"
        cy="224"
        rx="10"
        ry="4"
        fill={getColor("Обувь", "#cfcfd8")}
      />
      <ellipse
        cx="58"
        cy="224"
        rx="10"
        ry="4"
        fill={getColor("Обувь", "#cfcfd8")}
      />

      {/* Neck & Hands (Body details) */}
      <rect x="45" y="48" width="10" height="12" rx="2" fill={skinTone} />

      {/* Base Shirt (Torso) */}
      <path
        d="M22 68Q50 54 78 68L86 148L72 148L70 100L68 148L32 148L30 100L28 148L14 148Z"
        fill={getColor("Верх", "#3a3a48")}
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
          <path d="M34 36C34 20 66 20 66 36C66 48 34 48 34 36Z" fill={hairColor} />
        </>
      ) : (
        <>
          {/* Ears */}
          <circle cx="33" cy="37" r="3.5" fill={skinTone} />
          <circle cx="67" cy="37" r="3.5" fill={skinTone} />

          {/* Head Base */}
          <circle cx="50" cy="36" r="16" fill={skinTone} />

          {/* Hair Top */}
          <path d="M33 32Q50 12 67 32C62 24 38 24 33 32Z" fill={hairColor} />

          {/* Facial features: Eyebrows, Eyes, Nose */}
          {/* Eyebrows */}
          <path d="M41 31Q44 29 47 31" stroke={hairColor} strokeWidth="1.2" fill="none" />
          <path d="M53 31Q56 29 59 31" stroke={hairColor} strokeWidth="1.2" fill="none" />

          {/* Eyes */}
          <circle cx="44" cy="35" r="1.5" fill="#1f1f28" />
          <circle cx="56" cy="35" r="1.5" fill="#1f1f28" />

          {/* Nose hint */}
          <path d="M50 37L49 40H51" stroke="#b08b6e" strokeWidth="1" strokeLinecap="round" fill="none" />
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
