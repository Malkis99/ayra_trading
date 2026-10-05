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

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Aura */}
      {equipment["Аура"] != null && (
        <ellipse
          cx="50"
          cy="120"
          rx="54"
          ry="108"
          fill={getColor("Аура", "#a38ad1")}
          opacity="0.16"
          stroke={getColor("Аура", "#a38ad1")}
          strokeOpacity="0.6"
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

      {/* Legs & Shoes */}
      <path
        d="M32 140L68 140L66 222L53 222L50 165L47 222L34 222Z"
        fill={getColor("Низ", "#2b2b36")}
      />
      <ellipse
        cx="42"
        cy="224"
        rx="10"
        ry="4"
        fill={getColor("Обувь", "#555555")}
      />
      <ellipse
        cx="58"
        cy="224"
        rx="10"
        ry="4"
        fill={getColor("Обувь", "#555555")}
      />

      {/* Body / Top */}
      <path
        d="M22 68Q50 54 78 68L86 148L72 148L70 100L68 148L32 148L30 100L28 148L14 148Z"
        fill={getColor("Верх", "#3a3a48")}
      />

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
          <circle cx="15" cy="152" r="6" fill={getColor("Перчатки", "#d6d6e0")} />
          <circle cx="85" cy="152" r="6" fill={getColor("Перчатки", "#d6d6e0")} />
        </>
      )}

      {/* Head & Hair */}
      {back ? (
        <circle cx="50" cy="36" r="16" fill="#1a1a22" />
      ) : (
        <>
          <circle cx="50" cy="36" r="16" fill="#caa98e" />
          <path d="M34 32Q50 14 66 32Q50 25 34 32Z" fill="#1a1a22" />
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
            y="35"
            width="10"
            height="6"
            rx="2"
            fill="none"
            stroke={getColor("Аксессуар", "#a38ad1")}
            strokeWidth="1.5"
          />
          <rect
            x="52"
            y="35"
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
          className="bob"
          cx="90"
          cy="48"
          r="6"
          fill={getColor("Компаньон", "#a38ad1")}
        />
      )}
    </svg>
  );
}
