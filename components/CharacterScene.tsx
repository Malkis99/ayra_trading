"use client";

import React, { useState, useEffect, useRef } from "react";
import { Figure } from "@/components/Figure";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { SLOTS, SlotName, ITEMS, FRAMES, BACKGROUNDS } from "@/lib/items";
import {
  Shield,
  Shirt,
  Crown,
  Sparkles,
  Footprints,
  Eye,
  Bot,
  Flame,
  Layers,
  Feather,
} from "lucide-react";

const SLOT_ICONS: Record<SlotName, React.ReactNode> = {
  "Голова": <Crown size={18} />,
  "Верх": <Shirt size={18} />,
  "Верхняя": <Layers size={18} />,
  "Низ": <Feather size={18} />,
  "Обувь": <Footprints size={18} />,
  "Плащ": <Shield size={18} />,
  "Перчатки": <Sparkles size={18} />,
  "Аксессуар": <Eye size={18} />,
  "Аура": <Flame size={18} />,
  "Компаньон": <Bot size={18} />,
};

interface CharacterSceneProps {
  previewEquipment?: Record<string, number> | null;
  onSlotClick?: (slot: SlotName) => void;
  className?: string;
}

export function CharacterScene({
  previewEquipment,
  onSlotClick,
  className = "",
}: CharacterSceneProps) {
  const { gameState, setBackground } = useGame();
  const { dict, showToast, lang } = useApp();

  const [rotationAngle, setRotationAngle] = useState(0);
  const [isAutoRotating, setIsAutoRotating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startXRef = useRef<number>(0);
  const startAngleRef = useRef<number>(0);
  const autoRotateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const activeEquipment = previewEquipment || gameState.equipment || {};

  // Background style
  const bgOption = BACKGROUNDS[gameState.background % BACKGROUNDS.length];
  const bgName = lang === "en" ? bgOption.nameEn : bgOption.nameRu;

  const bgGradients = [
    "bg-radial from-[#241a38] via-[#161422] to-[#121117]",
    "bg-gradient-to-b from-[#1d1b2a] via-[#14131e] to-[#0e0d13]",
    "bg-gradient-to-b from-[#181822] to-[#0f0f15]",
  ];

  const frameColor =
    gameState.frame > 0 && FRAMES[gameState.frame]
      ? FRAMES[gameState.frame].color
      : "#2a2a35";

  // Auto-rotate effect
  useEffect(() => {
    if (isAutoRotating) {
      autoRotateIntervalRef.current = setInterval(() => {
        setRotationAngle((prev) => (prev + 2) % 360);
      }, 30);
    } else if (autoRotateIntervalRef.current) {
      clearInterval(autoRotateIntervalRef.current);
    }

    return () => {
      if (autoRotateIntervalRef.current) {
        clearInterval(autoRotateIntervalRef.current);
      }
    };
  }, [isAutoRotating]);

  // Handle pointer drag
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    setIsAutoRotating(false);
    startXRef.current = e.clientX;
    startAngleRef.current = rotationAngle;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startXRef.current;
    const newAngle = (startAngleRef.current + deltaX) % 360;
    setRotationAngle(newAngle < 0 ? newAngle + 360 : newAngle);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore capture release errors
      }
    }
  };

  // Keyboard rotation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      setRotationAngle((prev) => (prev - 10 + 360) % 360);
    } else if (e.key === "ArrowRight") {
      setRotationAngle((prev) => (prev + 10) % 360);
    }
  };

  const handleReset = () => {
    setRotationAngle(0);
    setIsAutoRotating(false);
    showToast(dict.profile.resetToast);
  };

  const handleToggleRotate = () => {
    setIsAutoRotating((prev) => !prev);
    showToast(dict.profile.rotateToast);
  };

  const handleCycleBackground = () => {
    const nextBg = (gameState.background + 1) % BACKGROUNDS.length;
    setBackground(nextBg);
    showToast(dict.profile.bgToast);
  };

  const isBackView = rotationAngle >= 90 && rotationAngle <= 270;

  // Split slots into 5 left and 5 right
  const leftSlots = SLOTS.slice(0, 5);
  const rightSlots = SLOTS.slice(5, 10);

  return (
    <div
      className={`relative card flex flex-col items-center justify-between p-4 min-h-[460px] overflow-hidden ${
        bgGradients[gameState.background % bgGradients.length]
      } ${className}`}
      style={{
        borderWidth: "1px",
        borderColor: frameColor,
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Character Scene"
    >
      {/* Top Header Chips */}
      <div className="flex w-full items-center justify-between text-xs gap-2 z-10">
        <span className="chip bg-s2/80 text-mu border border-line text-[11px] px-2.5 py-0.5">
          {dict.profile.dragHint}
        </span>
        <span className="chip bg-s2/80 text-vi-lt border border-vi/30 text-[11px] px-2.5 py-0.5 font-semibold">
          {dict.profile.streakDays.replace("{count}", String(gameState.currentStreak))}
        </span>
      </div>

      {/* Main Stage Grid: Left Slots - Character Center - Right Slots */}
      <div className="relative my-2 flex w-full items-center justify-between gap-2">
        {/* Left Slots column */}
        <div className="flex flex-col gap-2 z-10">
          {leftSlots.map((slot) => {
            const itemIdx = activeEquipment[slot];
            const isEquipped = itemIdx != null && ITEMS[itemIdx] != null;
            const item = isEquipped ? ITEMS[itemIdx] : null;
            const itemName = item ? (lang === "en" ? item.nameEn : item.nameRu) : null;

            return (
              <button
                key={slot}
                onClick={() => onSlotClick && onSlotClick(slot)}
                title={itemName ? `${slot}: ${itemName}` : slot}
                aria-label={`${slot}: ${itemName ? itemName : dict.profile.wardrobe.emptySlot}`}
                className={`relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-all duration-200 ${
                  isEquipped
                    ? "bg-s2 border-vi shadow-[0_0_8px_rgba(163,138,209,0.3)]"
                    : "bg-s1/60 border-line text-mu hover:border-vi hover:text-tx"
                }`}
                style={{
                  borderColor: item ? item.color : undefined,
                }}
              >
                {SLOT_ICONS[slot]}
                {isEquipped && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-black"
                    style={{ backgroundColor: item?.color }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Center Rotating Character */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative flex-1 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none py-2"
        >
          {/* Subtle Glow behind figure */}
          <div className="absolute h-56 w-56 rounded-full bg-vi/10 blur-2xl pointer-events-none" />

          {/* Soft Oval Shadow under feet (DRAWN OUTSIDE ROTATING CONTAINER) */}
          <div className="absolute bottom-2 h-4 w-32 rounded-[100%] bg-black/60 blur-xs pointer-events-none" />

          {/* Rotating Container */}
          <div
            className="transition-transform duration-75 ease-out motion-reduce:transition-none"
            style={{
              transform: `rotateY(${rotationAngle}deg)`,
            }}
          >
            <Figure
              equipment={activeEquipment}
              width={140}
              height={270}
              back={isBackView}
              className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.4)]"
            />
          </div>
        </div>

        {/* Right Slots column */}
        <div className="flex flex-col gap-2 z-10">
          {rightSlots.map((slot) => {
            const itemIdx = activeEquipment[slot];
            const isEquipped = itemIdx != null && ITEMS[itemIdx] != null;
            const item = isEquipped ? ITEMS[itemIdx] : null;
            const itemName = item ? (lang === "en" ? item.nameEn : item.nameRu) : null;

            return (
              <button
                key={slot}
                onClick={() => onSlotClick && onSlotClick(slot)}
                title={itemName ? `${slot}: ${itemName}` : slot}
                aria-label={`${slot}: ${itemName ? itemName : dict.profile.wardrobe.emptySlot}`}
                className={`relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-all duration-200 ${
                  isEquipped
                    ? "bg-s2 border-vi shadow-[0_0_8px_rgba(163,138,209,0.3)]"
                    : "bg-s1/60 border-line text-mu hover:border-vi hover:text-tx"
                }`}
                style={{
                  borderColor: item ? item.color : undefined,
                }}
              >
                {SLOT_ICONS[slot]}
                {isEquipped && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-black"
                    style={{ backgroundColor: item?.color }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className="flex gap-2 z-10 mt-2">
        <button
          onClick={handleReset}
          className="btn-ghost text-xs py-1 px-3 border border-line rounded-lg hover:border-vi"
        >
          {dict.profile.reset}
        </button>
        <button
          onClick={handleToggleRotate}
          className={`btn-ghost text-xs py-1 px-3 border rounded-lg transition-colors ${
            isAutoRotating
              ? "border-vi text-vi-lt bg-vi/10"
              : "border-line hover:border-vi"
          }`}
        >
          {dict.profile.rotate}
        </button>
        <button
          onClick={handleCycleBackground}
          className="btn-ghost text-xs py-1 px-3 border border-line rounded-lg hover:border-vi"
        >
          {dict.profile.background} ({bgName})
        </button>
      </div>
    </div>
  );
}
