"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { Figure } from "@/components/Figure";
import { SlotName, ITEMS, FRAMES } from "@/lib/items";
import { formatString, formatNumber } from "@/lib/i18n";

const LEFT_SLOTS: SlotName[] = ["Голова", "Верх", "Верхняя", "Низ", "Обувь"];
const RIGHT_SLOTS: SlotName[] = ["Плащ", "Перчатки", "Аксессуар", "Аура", "Компаньон"];

interface CharacterStageProps {
  onSlotClick?: (slot: SlotName) => void;
}

export function CharacterStage({ onSlotClick }: CharacterStageProps) {
  const { gameState, effectiveEquipment, previewItem, cycleBackground } = useGame();
  const { dict, lang, showToast } = useApp();

  const [ry, setRy] = useState<number>(20);
  const [isAutoSpinning, setIsAutoSpinning] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const startXRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const frameColor = FRAMES[gameState.frame]?.color || "#a38ad1";
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

    let rarityClass = "e"; // empty
    if (item) {
      rarityClass = item.rarity === 2 ? "r2" : item.rarity === 1 ? "r1" : "r0";
    }

    // Translate slot name or item name
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

    return (
      <button
        key={slotName}
        type="button"
        onClick={() => onSlotClick && onSlotClick(slotName)}
        className={`slot ${rarityClass}`}
        title={slotLabel}
      >
        <i>{item ? itemLabel.split(" ")[0] : slotLabel}</i>
      </button>
    );
  };

  const completedTodayCount = Object.keys(gameState.completedQuestsToday).length;

  return (
    <div className={`card stage p-3.5 sm:p-4 grid grid-cols-[48px_1fr_48px] sm:grid-cols-[60px_1fr_60px] gap-2 sm:gap-2.5 items-center ${bgClass} shadow-2xl`}>
      {/* Left 5 Slots */}
      <div className="flex flex-col gap-2.5 z-10">{LEFT_SLOTS.map(renderSlot)}</div>

      {/* Center 3D Rotation Stage */}
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
        className="stage-frame relative min-h-[400px] rounded-2xl border-1.5 flex flex-col items-center justify-between p-3 focus-visible:ring-2 focus-visible:ring-vi"
        style={{ borderColor: frameColor }}
      >
        {/* Rings */}
        <i className="ring ring-a pointer-events-none" />
        <i className="ring ring-b pointer-events-none" />

        {/* 3D Turn Container */}
        <div className="turn-3d" style={{ transform: `rotateY(${ry}deg)` }}>
          <div className="front-3d flex justify-center">
            <Figure equipment={effectiveEquipment} viewBox="0 0 100 230" width={170} height={390} back={false} />
          </div>
          <div className="bk-3d flex justify-center">
            <Figure equipment={effectiveEquipment} viewBox="0 0 100 230" width={170} height={390} back={true} />
          </div>
        </div>

        {/* Control Buttons Bar */}
        <div className="stage-ctl relative z-10 flex gap-1.5 rounded-full border border-white/10 bg-black/50 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full px-3 py-1.5 text-xs text-tx transition hover:bg-pri/40"
            title={dict.profile.resetTitle}
          >
            {dict.profile.reset}
          </button>
          <button
            type="button"
            onClick={handleToggleAutoSpin}
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              isAutoSpinning ? "bg-pri text-white font-semibold" : "text-tx hover:bg-pri/40"
            }`}
          >
            {dict.profile.rotate}
          </button>
          <button
            type="button"
            onClick={() => {
              cycleBackground();
              showToast(dict.profile.bgToast);
            }}
            className="rounded-full px-3 py-1.5 text-xs text-tx transition hover:bg-pri/40"
          >
            {dict.profile.background}
          </button>
        </div>

        {/* Status Chips */}
        <div className="stb relative z-10 mt-2 flex flex-wrap justify-center gap-1.5">
          <span className="chip">
            {previewItem != null ? dict.profile.previewing : dict.profile.dragHint}
          </span>
          <span className="chip">
            {formatString(dict.profile.streakCounter, {
              current: formatNumber(lang, completedTodayCount),
            })}
          </span>
        </div>
      </div>

      {/* Right 5 Slots */}
      <div className="flex flex-col gap-2.5 z-10">{RIGHT_SLOTS.map(renderSlot)}</div>
    </div>
  );
}
