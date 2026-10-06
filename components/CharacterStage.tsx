"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { Figure } from "@/components/Figure";
import { SlotName, ITEMS, FRAMES } from "@/lib/items";
import { formatString, formatNumber } from "@/lib/i18n";
import {
  Crown,
  Shirt,
  Shield,
  Footprints,
  Sparkles,
  Glasses,
  Smile,
  Zap,
  Bot,
  RotateCcw,
  RefreshCw,
  Image,
} from "lucide-react";

const LEFT_SLOTS: SlotName[] = ["Голова", "Верх", "Верхняя", "Низ", "Обувь"];
const RIGHT_SLOTS: SlotName[] = ["Плащ", "Перчатки", "Аксессуар", "Аура", "Компаньон"];

const SLOT_ICONS: Record<SlotName, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Голова: Crown,
  Верх: Shirt,
  Верхняя: Shield,
  Низ: Shield,
  Обувь: Footprints,
  Плащ: Sparkles,
  Перчатки: Zap,
  Аксессуар: Glasses,
  Аура: Smile,
  Компаньон: Bot,
};

interface CharacterStageProps {
  onSlotClick?: (slot: SlotName) => void;
  selectedSlot?: SlotName | null;
}

export function CharacterStage({ onSlotClick, selectedSlot }: CharacterStageProps) {
  const { gameState, effectiveEquipment, previewItem, cycleBackground } = useGame();
  const { dict, lang, showToast } = useApp();

  const [ry, setRy] = useState<number>(20);
  const [isAutoSpinning, setIsAutoSpinning] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const startXRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const frameColor = FRAMES[gameState.frame]?.color || "#2a2a35";
  const bgClass = `stage-bg-${gameState.background % 3}`;

  // Stop auto spin
  const stopAutoSpin = useCallback(() => {
    setIsAutoSpinning(false);
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  // Reset rotation
  const handleReset = () => {
    setRy(20);
    stopAutoSpin();
    showToast(dict.profile.resetToast);
  };

  // Toggle auto spin
  const handleToggleAutoSpin = () => {
    if (typeof window !== "undefined") {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) {
        showToast(dict.profile.rotateToast);
        return;
      }
    }

    if (isAutoSpinning) {
      stopAutoSpin();
    } else {
      setIsAutoSpinning(true);
      showToast(dict.profile.rotateToast);
    }
  };

  // Auto spin effect
  useEffect(() => {
    if (!isAutoSpinning) {
      if (animFrameRef.current != null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    let lastTime = performance.now();
    const spinLoop = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;
      setRy((prev) => (prev + (delta / 1000) * 40) % 360);
      animFrameRef.current = requestAnimationFrame(spinLoop);
    };

    animFrameRef.current = requestAnimationFrame(spinLoop);

    return () => {
      if (animFrameRef.current != null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isAutoSpinning]);

  // Handle page visibility change and unmount
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopAutoSpin();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopAutoSpin();
    };
  }, [stopAutoSpin]);

  // Pointer event handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore clicks on control buttons
    if ((e.target as HTMLElement).closest(".stage-ctl")) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    setIsDragging(true);
    stopAutoSpin();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startXRef.current;
    startXRef.current = e.clientX;
    setRy((prev) => (prev + deltaX * 0.8) % 360);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stopAutoSpin();
      const step = e.shiftKey ? 45 : 15;
      setRy((prev) => (prev - step) % 360);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stopAutoSpin();
      const step = e.shiftKey ? 45 : 15;
      setRy((prev) => (prev + step) % 360);
    }
  };

  const renderSlot = (slotName: SlotName) => {
    const itemIndex = effectiveEquipment[slotName];
    const item = itemIndex != null ? ITEMS[itemIndex] : null;

    const slotKeyMap: Record<string, string> = {
      Голова: "head",
      Верх: "top",
      Верхняя: "outer",
      Низ: "bottom",
      Обувь: "shoes",
      Плащ: "cloak",
      Перчатки: "gloves",
      Аксессуар: "accessory",
      Аура: "aura",
      Компаньон: "companion",
    };

    const slotKey = slotKeyMap[slotName] || "top";
    const slotLabel = (dict.slots as any)[slotKey] || slotName;

    let itemLabel = slotLabel;
    if (item) {
      const nameKeyShort = item.nameKey.replace("items.", "");
      itemLabel = (dict.items as any)[nameKeyShort] || itemLabel;
    }

    const IconComp = SLOT_ICONS[slotName] || Shield;
    const isSelected = selectedSlot === slotName;

    let borderStyle = "border-line bg-s1/60 hover:border-vi/60 text-mu";
    if (item) {
      if (item.rarity === 2) borderStyle = "border-go bg-go/10 text-go";
      else if (item.rarity === 1) borderStyle = "border-vi bg-vi/10 text-vi";
      else borderStyle = "border-line bg-s2 text-tx";
    }

    if (isSelected) {
      borderStyle += " ring-2 ring-vi border-vi shadow-[0_0_12px_#50348f66]";
    }

    return (
      <button
        key={slotName}
        type="button"
        onClick={() => onSlotClick && onSlotClick(slotName)}
        aria-label={item ? `${slotLabel}: ${itemLabel}` : `${slotLabel}: Пусто`}
        title={item ? `${slotLabel}: ${itemLabel}` : slotLabel}
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer relative group ${borderStyle}`}
      >
        {item ? (
          <div
            className="w-5 h-5 rounded-md shadow-inner flex items-center justify-center"
            style={{ backgroundColor: item.color }}
          >
            <IconComp size={12} className="text-white drop-shadow-sm" />
          </div>
        ) : (
          <IconComp size={18} className="opacity-70 group-hover:scale-110 transition-transform" />
        )}
      </button>
    );
  };

  return (
    <div className={`card stage p-3 sm:p-4 flex flex-col justify-between h-full min-h-[480px] lg:min-h-[640px] relative overflow-hidden ${bgClass} shadow-xl border border-line`}>
      {/* Background Soft Glow without borders */}
      <div className="absolute inset-0 bg-gradient-to-b from-pri/5 via-transparent to-black/40 pointer-events-none" />

      {/* Main Interactive Stage Grid */}
      <div className="relative z-10 flex-1 grid grid-cols-[48px_1fr_48px] sm:grid-cols-[52px_1fr_52px] gap-2 items-center">
        {/* Left Slots */}
        <div className="flex flex-col gap-3 justify-center">{LEFT_SLOTS.map(renderSlot)}</div>

        {/* Center 3D Rotation Frame */}
        <div
          tabIndex={0}
          role="region"
          aria-label={dict.profile.dragHint}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={() => setIsDragging(false)}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsDragging(false)}
          className="relative h-full min-h-[380px] rounded-2xl border flex flex-col items-center justify-center p-2 focus-visible:ring-2 focus-visible:ring-vi cursor-grab active:cursor-grabbing select-none"
          style={{ borderColor: frameColor, borderWidth: "1px" }}
        >
          {/* Oval Shadow under feet - fixed outside rotating figure */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-28 h-5 rounded-[100%] bg-black/60 blur-xs pointer-events-none" />

          {/* 3D Turn Container */}
          <div className="turn-3d h-full flex items-center justify-center" style={{ transform: `rotateY(${ry}deg)` }}>
            <div className="front-3d flex justify-center items-center h-full">
              <Figure equipment={effectiveEquipment} viewBox="0 0 100 230" width="85%" height="85%" back={false} />
            </div>
            <div className="bk-3d flex justify-center items-center h-full">
              <Figure equipment={effectiveEquipment} viewBox="0 0 100 230" width="85%" height="85%" back={true} />
            </div>
          </div>
        </div>

        {/* Right Slots */}
        <div className="flex flex-col gap-3 justify-center">{RIGHT_SLOTS.map(renderSlot)}</div>
      </div>

      {/* Controls & Status Chips at Stage Bottom */}
      <div className="relative z-10 pt-3 border-t border-line/50 flex flex-col items-center gap-2">
        {/* Control Buttons Bar */}
        <div className="stage-ctl flex gap-1 rounded-full border border-white/10 bg-black/60 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full p-2 text-xs text-tx hover:bg-pri/40 transition-colors"
            aria-label={dict.profile.resetTitle}
            title={dict.profile.resetTitle}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={handleToggleAutoSpin}
            className={`rounded-full p-2 text-xs transition-colors ${
              isAutoSpinning ? "bg-pri text-white font-semibold" : "text-tx hover:bg-pri/40"
            }`}
            aria-label={dict.profile.rotateToast}
            title={dict.profile.rotateToast}
          >
            <RefreshCw size={14} className={isAutoSpinning ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={() => {
              cycleBackground();
              showToast(dict.profile.bgToast);
            }}
            className="rounded-full p-2 text-xs text-tx hover:bg-pri/40 transition-colors"
            aria-label={dict.profile.bgToast}
            title={dict.profile.bgToast}
          >
            <Image size={14} />
          </button>
        </div>

        {/* Status Chips */}
        <div className="flex flex-wrap justify-center gap-2 text-[11px]">
          <span className="chip bg-s1/80 border-line">
            {previewItem != null ? dict.profile.previewing : dict.profile.dragHint}
          </span>
          <span className="chip bg-s1/80 border-line">
            {formatString("Серия: {count} дн.", {
              count: formatNumber(lang, gameState.currentStreak),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
